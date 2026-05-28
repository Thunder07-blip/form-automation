// content.js

function writeLog(category, message) {
  chrome.runtime.sendMessage({
    action: "ADD_LOG",
    source: "Content Script",
    category: category,
    message: message
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT_QUESTIONS") {
    writeLog("DOM Scanning", "Received request to scan page form structure.");
    
    // Save the before_running HTML locally via the background script
    chrome.runtime.sendMessage({
      action: "SAVE_HTML_LOCAL",
      filename: "before_running.html",
      html: document.documentElement.outerHTML
    }).catch(() => {});

    const scanner = new GroupAwareFormScanner();
    scanner.scanForm()
      .then(scannedBlocks => {
        writeLog("DOM Scanning", `Successfully scanned ${scannedBlocks.length} outer block(s).`);
        // We must serialize scannedBlocks before sending to popup, because elements (nodes) cannot be serialized.
        const serializedBlocks = scannedBlocks.map(block => ({
          blockIndex: block.blockIndex,
          promptText: block.promptText,
          components: block.components.map(comp => {
            const serializedComp = { type: comp.type };
            if (comp.type === 'MULTIPLE_CHOICE' || comp.type === 'CHECKBOXES') {
              serializedComp.options = comp.options.map(o => o.text);
            } else if (comp.type === 'TEXT_INPUT') {
              serializedComp.placeholder = comp.placeholder;
            } else if (comp.type === 'DROPDOWN') {
              serializedComp.options = comp.options ? comp.options.map(o => o.text) : [];
            }
            return serializedComp;
          })
        }));

        // Cache the full scannedBlocks containing DOM nodes globally so we can fill them later!
        window.lastScannedBlocks = scannedBlocks;

        sendResponse({ status: "success", blocks: serializedBlocks });
      })
      .catch(err => {
        writeLog("Error", `DOM Scan failed: ${err.message}`);
        console.error("[FormAI] Extraction error:", err);
        sendResponse({ status: "error", message: "Couldn't detect questions. The page might not be fully loaded or isn't a supported form." });
      });
    return true; // Keep message channel open
  }
  
  if (request.action === "FILL_ANSWERS") {
    writeLog("Automation Initiation", "Received request to fill form answers.");
    fillPolymorphicAnswers(request.answers)
      .then(() => {
        writeLog("Automation Completion", "All answers filled successfully.");
        
        // Save the after_running HTML locally via the background script
        chrome.runtime.sendMessage({
          action: "SAVE_HTML_LOCAL",
          filename: "after_running.html",
          html: document.documentElement.outerHTML
        }).catch(() => {});

        sendResponse({ status: "success" });
      })
      .catch((err) => {
        writeLog("Error", `Filling failed: ${err.message}`);
        console.error("[FormAI] Filling error:", err);
        sendResponse({ status: "error", message: "Failed to fill some answers." });
      });
    return true;
  }
});

async function fillPolymorphicAnswers(answers) {
  const scannedBlocks = window.lastScannedBlocks;
  if (!scannedBlocks) {
    writeLog("Error", "Attempted to fill answers, but no cached scanned blocks were found.");
    throw new Error("No cached scanned blocks found to fill.");
  }

  const answersArray = answers || [];
  console.log(`[FormAI] Starting fill. ${scannedBlocks.length} scanned blocks, ${answersArray.length} answers`);
  writeLog("Automation Process", `Applying answers to ${answersArray.length} block(s).`);

  for (const blockAns of answersArray) {
    if (!blockAns) continue;
    const block = scannedBlocks.find(b => b.blockIndex === blockAns.blockIndex);
    if (!block) {
      console.warn(`[FormAI] No scanned block found matching blockIndex ${blockAns.blockIndex}`);
      writeLog("Automation Warning", `Could not find cached DOM block matching index ${blockAns.blockIndex}`);
      continue;
    }

    try {
      writeLog("Automation Process", `Executing actions for block ${blockAns.blockIndex} ("${block.promptText.substring(0, 30)}...")`);
      await PolymorphicFormRunner.executeBlockActions(block, blockAns.actions);
    } catch (err) {
      writeLog("Error", `Block ${blockAns.blockIndex} action execution failed: ${err.message}`);
      console.error(`[FormAI] Failed to execute actions for block ${blockAns.blockIndex}:`, err);
    }
  }
}

class GroupAwareFormScanner {
  constructor() {
    this.blockSelector = 'div[role="listitem"], .Qr7Oae';
    this.titleSelector = 'div[role="heading"], .M7eMe';
  }

  async scanForm() {
    writeLog("DOM Scanning", "Starting scan of form fields...");
    const serializedForm = [];
    const blocks = Array.from(document.querySelectorAll(this.blockSelector));
    
    // Filter blocks: if block A is contained within block B, keep only the outermost block.
    const outermostBlocks = blocks.filter(b => !blocks.some(parent => parent !== b && parent.contains(b)));
    writeLog("DOM Scanning", `Found ${blocks.length} block elements, filtered to ${outermostBlocks.length} outermost blocks.`);

    for (let index = 0; index < outermostBlocks.length; index++) {
      const block = outermostBlocks[index];
      const titleEl = block.querySelector(this.titleSelector);
      if (!titleEl) continue;

      let questionText = titleEl.textContent.trim().replace(/\s\*$/, '');
      if (!questionText) continue;

      // Locate all potential interactive layers inside THIS specific question wrapper
      const radioElements = Array.from(block.querySelectorAll('[role="radio"]'));
      const checkboxElements = Array.from(block.querySelectorAll('[role="checkbox"]'));
      const dropdown = block.querySelector('[role="listbox"]');
      const textInputs = Array.from(block.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="number"], input[type="tel"], textarea'
      ));

      // Initialize the core group metadata structure
      const components = [];

      // Map out Multiple Choice options if they exist
      if (radioElements.length > 0) {
        const options = radioElements.map(el => ({
          text: (el.getAttribute('data-value') || el.getAttribute('aria-label') || el.textContent || "").trim(),
          node: el
        }));
        components.push({ type: 'MULTIPLE_CHOICE', options });
      }

      // Map out Checkboxes if they exist
      if (checkboxElements.length > 0) {
        const options = checkboxElements.map(el => ({
          text: (el.getAttribute('data-value') || el.getAttribute('aria-label') || el.textContent || "").trim(),
          node: el
        }));
        components.push({ type: 'CHECKBOXES', options });
      }

      // Map out Dropdowns if they exist
      if (dropdown) {
        let optionsContainer = dropdown.querySelector('.OA0qNb, .QXL7Te');
        if (!optionsContainer) {
          const ownsId = dropdown.getAttribute('aria-owns') || dropdown.getAttribute('aria-controls');
          if (ownsId) {
            optionsContainer = document.getElementById(ownsId);
          }
        }

        // Only use optionsContainer if it actually contains option elements.
        // Otherwise, fall back to searching inside the dropdown node, then the whole block.
        const hasOptions = optionsContainer && optionsContainer.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
        const searchRoot = (optionsContainer && hasOptions) ? optionsContainer : dropdown;

        let preloadedOpts = Array.from(searchRoot.querySelectorAll('[role="option"]'));
        if (preloadedOpts.length === 0 && searchRoot !== block) {
          preloadedOpts = Array.from(block.querySelectorAll('[role="option"]'));
        }

        if (preloadedOpts.length === 0) {
          preloadedOpts = Array.from(searchRoot.querySelectorAll('[data-value]')).filter(el => el !== dropdown);
          if (preloadedOpts.length === 0 && searchRoot !== block) {
            preloadedOpts = Array.from(block.querySelectorAll('[data-value]')).filter(el => el !== dropdown);
          }
        }

        if (preloadedOpts.length === 0) {
          preloadedOpts = Array.from(searchRoot.querySelectorAll('.vxx8jf'));
          if (preloadedOpts.length === 0 && searchRoot !== block) {
            preloadedOpts = Array.from(block.querySelectorAll('.vxx8jf'));
          }
        }

        let options = preloadedOpts.map(el => {
          const dv = el.getAttribute('data-value');
          const al = el.getAttribute('aria-label');
          const tx = el.textContent || el.innerText || "";
          return {
            text: (dv || al || tx).trim(),
            node: el
          };
        }).filter(o => o.text !== "" && o.text.toLowerCase() !== "choose" && o.text.toLowerCase() !== "select");

        // Fallback: If no options found, click to open and scan dynamically!
        if (options.length === 0) {
          console.log("[FormAI] Dropdown options not preloaded. Attempting dynamic scan...");
          writeLog("DOM Scanning", `Dropdown options not preloaded for Block ${index}. Clicking to open dropdown for dynamic option scan...`);
          dropdown.scrollIntoView({ behavior: "auto", block: "center" });
          await new Promise(r => setTimeout(r, 100));

          // Check if already open
          const isExpanded = dropdown.getAttribute('aria-expanded') === 'true';
          const ownsId = dropdown.getAttribute('aria-owns') || dropdown.getAttribute('aria-controls');
          let isMenuVisible = false;
          if (ownsId) {
            const menu = document.getElementById(ownsId);
            if (menu) {
              const rect = menu.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                isMenuVisible = true;
              }
            }
          }
          const isAlreadyOpen = isExpanded || isMenuVisible;

          if (!isAlreadyOpen) {
            // Click to open
            PolymorphicFormRunner.triggerNaturalClick(dropdown);
          }
          
          // Wait and actively poll for the dropdown options menu to appear and contain options (up to 1.5 seconds)
          let dynamicOpts = [];
          let visibleMenu = null;
          
          for (let poll = 0; poll < 15; poll++) {
            // Check private menu container first
            visibleMenu = dropdown.querySelector('.OA0qNb, .QXL7Te');
            if (visibleMenu) {
              const rect = visibleMenu.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) {
                visibleMenu = null;
              }
            }
            if (!visibleMenu && ownsId) {
              const menu = document.getElementById(ownsId);
              if (menu) {
                const rect = menu.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  visibleMenu = menu;
                }
              }
            }
            if (!visibleMenu) {
              const menus = Array.from(document.querySelectorAll('.OA0qNb, .QXL7Te'));
              visibleMenu = menus.find(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
            }
            
            if (visibleMenu) {
              dynamicOpts = Array.from(visibleMenu.querySelectorAll('[role="option"]'));
              if (dynamicOpts.length === 0) {
                dynamicOpts = Array.from(visibleMenu.querySelectorAll('[data-value]'));
              }
              if (dynamicOpts.length === 0) {
                dynamicOpts = Array.from(visibleMenu.querySelectorAll('.vxx8jf'));
              }
              if (dynamicOpts.length > 0) {
                break;
              }
            }
            await new Promise(r => setTimeout(r, 100));
          }
          
          if (dynamicOpts.length === 0) {
            // Document-wide fallback
            const allOpts = Array.from(document.querySelectorAll('[role="option"], [data-value], .vxx8jf'));
            dynamicOpts = allOpts.filter(el => {
              if (el === dropdown) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          }
          
          options = dynamicOpts.map(el => {
            const dv = el.getAttribute('data-value');
            const al = el.getAttribute('aria-label');
            const tx = el.textContent || el.innerText || "";
            return {
              text: (dv || al || tx).trim(),
              node: el
            };
          }).filter(o => o.text !== "" && o.text.toLowerCase() !== "choose" && o.text.toLowerCase() !== "select");
          
          writeLog("DOM Scanning", `Dynamic options scan detected ${options.length} option(s) for dropdown.`);
          
          if (!isAlreadyOpen) {
            // Click again to close it
            PolymorphicFormRunner.triggerNaturalClick(dropdown);
            
            // Wait for the menu container to close completely
            const finalMenu = visibleMenu || dropdown.querySelector('.OA0qNb, .QXL7Te') || (ownsId ? document.getElementById(ownsId) : null);
            if (finalMenu) {
              let isClosed = false;
              for (let closeAttempt = 0; closeAttempt < 15; closeAttempt++) {
                const rect = finalMenu.getBoundingClientRect();
                const style = window.getComputedStyle(finalMenu);
                if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden') {
                  isClosed = true;
                  break;
                }
                await new Promise(r => setTimeout(r, 50));
              }
              
              if (!isClosed) {
                // Force close via Escape key
                dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                await new Promise(r => setTimeout(r, 100));
                
                // Double check, if still open, toggle dropdown click
                const rect = finalMenu.getBoundingClientRect();
                const style = window.getComputedStyle(finalMenu);
                if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                  PolymorphicFormRunner.triggerNaturalClick(dropdown);
                  await new Promise(r => setTimeout(r, 150));
                }
              }
            } else {
              await new Promise(r => setTimeout(r, 250));
            }
          }
        }

        components.push({ type: 'DROPDOWN', node: dropdown, options });
      }

      // Handle the text input layers nested in the same block.
      // Exclude text inputs that are part of other selections (e.g. "Other:" input).
      const primaryTextInputs = textInputs.filter(inputNode => {
        const isInsideOption = radioElements.some(r => r.contains(inputNode)) || 
                               checkboxElements.some(c => c.contains(inputNode));
        return !isInsideOption;
      });

      primaryTextInputs.forEach(inputNode => {
        components.push({
          type: 'TEXT_INPUT',
          node: inputNode,
          placeholder: inputNode.placeholder || inputNode.getAttribute('aria-label') || 'Text field'
        });
      });

      // Only track blocks that actually contain actionable input components
      if (components.length > 0) {
        writeLog("DOM Scanning", `Block ${index}: "${questionText.substring(0, 30)}..." -> components: [${components.map(c => c.type).join(', ')}]`);
        serializedForm.push({
          blockIndex: index,
          promptText: questionText,
          components: components
        });
      }
    }

    writeLog("DOM Scanning", `DOM Scan complete. Form structure serialized with ${serializedForm.length} actionable block(s).`);
    return serializedForm;
  }
}

class PolymorphicFormRunner {
  static async executeBlockActions(scannedBlock, aiActions) {
    if (!scannedBlock || !scannedBlock.components || !aiActions) return;
    const components = scannedBlock.components;

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const action = aiActions[i]; // Pair step-for-step with AI instructions

      if (!action || comp.type !== action.type) {
        writeLog("DOM Warning", `Block ${scannedBlock.blockIndex}: Action type mismatch or missing. Expected: ${comp.type}, Got: ${action?.type}`);
        console.warn(`[FormAI] Action mismatch or missing for block ${scannedBlock.blockIndex} component ${i}. Expected: ${comp.type}, got: ${action?.type}`);
        continue;
      }

      console.log(`[FormAI] Executing on block ${scannedBlock.blockIndex} | Type: ${comp.type} | Value: "${action.value}"`);

      if (comp.type === 'MULTIPLE_CHOICE') {
        if (!comp.options) continue;
        const actionValStr = String(action.value || "").toLowerCase().trim();
        if (actionValStr === "" || actionValStr === "none") {
          writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [MULTIPLE_CHOICE]: Empty or fallback value. Skipping.`);
          continue;
        }
        const targetOption = comp.options.find(
          opt => {
            const optTextLower = String(opt.text || "").toLowerCase().trim();
            return optTextLower === actionValStr
              || optTextLower.includes(actionValStr)
              || actionValStr.includes(optTextLower);
          }
        );
        if (targetOption) {
          writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [MULTIPLE_CHOICE]: Selecting option "${targetOption.text}"`);
          targetOption.node.scrollIntoView({ behavior: "auto", block: "center" });
          await new Promise(r => setTimeout(r, 100));
          this.triggerNaturalClick(targetOption.node);
        } else {
          writeLog("DOM Warning", `Block ${scannedBlock.blockIndex} [MULTIPLE_CHOICE]: No matching option found for value "${action.value}"`);
          console.warn(`[FormAI] Option match not found for MULTIPLE_CHOICE: "${action.value}"`);
        }
      } 
      
      else if (comp.type === 'CHECKBOXES') {
        if (!comp.options) continue;
        const valStr = String(action.value || "").trim();
        if (valStr === "" || valStr.toLowerCase() === "none") {
          writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [CHECKBOXES]: Empty or fallback value. Skipping.`);
          continue;
        }
        const targetValues = valStr.split(',').map(v => v.trim().toLowerCase());
        writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [CHECKBOXES]: Syncing values: "${action.value}"`);
        for (const opt of comp.options) {
          const optTextLower = String(opt.text || "").toLowerCase().trim();
          const shouldBeChecked = targetValues.some(val => optTextLower.includes(val) || val.includes(optTextLower));
          
          const isChecked = opt.node.getAttribute('aria-checked') === 'true';
          if (shouldBeChecked !== isChecked) {
            writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [CHECKBOXES]: Toggling "${opt.text}" to ${shouldBeChecked ? 'checked' : 'unchecked'}`);
            opt.node.scrollIntoView({ behavior: "auto", block: "center" });
            await new Promise(r => setTimeout(r, 100));
            this.triggerNaturalClick(opt.node);
            await new Promise(r => setTimeout(r, 100));
          }
        }
      }

      else if (comp.type === 'DROPDOWN') {
        const valStr = String(action.value || "").trim();
        if (valStr === "" || valStr.toLowerCase() === "none") {
          writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [DROPDOWN]: Empty or fallback value. Skipping.`);
          continue;
        }
        writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [DROPDOWN]: Selecting option matching "${valStr}"`);
        await this.triggerDropdownSelection(comp.node, valStr, scannedBlock.blockIndex);
      }
      
      else if (comp.type === 'TEXT_INPUT') {
        if (!comp.node) continue;
        const valStr = String(action.value || "").trim();
        if (valStr === "" || valStr.toLowerCase() === "none") {
          writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [TEXT_INPUT]: Empty or fallback value. Skipping.`);
          continue;
        }
        writeLog("DOM Action", `Block ${scannedBlock.blockIndex} [TEXT_INPUT]: Injecting value "${valStr}"`);
        comp.node.scrollIntoView({ behavior: "auto", block: "center" });
        await new Promise(r => setTimeout(r, 150));
        this.injectTextValue(comp.node, valStr);
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  static triggerNaturalClick(element) {
    if (!element) return;
    
    // For WIZ event delegation (Google Forms), clicking the outer role="listbox" 
    // container directly often fails because WIZ listens on jsname="LgbsSe" children.
    // We target the inner jsname="LgbsSe" or .ry3kXd element if available.
    let clickTarget = element;
    if (element.getAttribute('role') === 'listbox') {
      const innerTarget = element.querySelector('[jsname="LgbsSe"]') || element.querySelector('.ry3kXd');
      if (innerTarget) {
        clickTarget = innerTarget;
      }
    }

    const opts = { bubbles: true, cancelable: true, view: window };
    clickTarget.dispatchEvent(new PointerEvent('pointerdown', opts));
    clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
    clickTarget.dispatchEvent(new PointerEvent('pointerup', opts));
    clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
    clickTarget.dispatchEvent(new MouseEvent('click', opts));
    
    if (clickTarget !== element && typeof clickTarget.click === 'function') {
      clickTarget.click();
    }
  }

  static injectTextValue(inputElement, text) {
    if (!inputElement) return;
    inputElement.focus();
    
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

    if (nativeInputSetter) {
      nativeInputSetter.call(inputElement, text);
    } else {
      inputElement.value = text;
    }

    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    inputElement.blur();
  }

  static async triggerDropdownSelection(dropdownNode, targetValue, blockIndex = -1) {
    const blockContext = blockIndex !== -1 ? `Block ${blockIndex} ` : "";
    if (!dropdownNode) return;
    
    const cleanTarget = String(targetValue || "").trim();
    if (cleanTarget === "" || cleanTarget.toLowerCase() === "none") {
      writeLog("Dropdown Warning", `${blockContext}Skipping selection for empty or "none" value.`);
      return;
    }
    
    dropdownNode.scrollIntoView({ behavior: "auto", block: "center" });
    await new Promise(r => setTimeout(r, 150));
    
    // Check if the dropdown is already expanded/open
    const isExpanded = dropdownNode.getAttribute('aria-expanded') === 'true';
    const ownsId = dropdownNode.getAttribute('aria-owns') || dropdownNode.getAttribute('aria-controls');
    
    // Determine the specific private menu container nested inside the dropdownNode
    let targetMenu = dropdownNode.querySelector('.OA0qNb, .QXL7Te');
    let isMenuVisible = false;
    if (targetMenu) {
      // Robust visibility check: must contain options and not be display: none
      const hasOptions = targetMenu.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
      const style = window.getComputedStyle(targetMenu);
      if (hasOptions && style.display !== 'none' && style.visibility !== 'hidden') {
        isMenuVisible = true;
      }
    }
    
    const isAlreadyOpen = isExpanded || isMenuVisible;

    if (!isAlreadyOpen) {
      writeLog("Dropdown Solver", `${blockContext}Opening dropdown listbox...`);
      this.triggerNaturalClick(dropdownNode);
    } else {
      writeLog("Dropdown Solver", `${blockContext}Dropdown is already open, skipping open click.`);
    }
    
    // Wait for the dropdown options menu to appear and contain options (up to 1.5 seconds)
    let optionsToSearch = [];
    let activeMenu = null;
    
    for (let attempt = 0; attempt < 15; attempt++) {
      // Re-query the private options container inside the loop to avoid detached node references!
      activeMenu = dropdownNode.querySelector('.OA0qNb, .QXL7Te');
      if (activeMenu) {
        optionsToSearch = Array.from(activeMenu.querySelectorAll('[role="option"]'));
        if (optionsToSearch.length === 0) {
          optionsToSearch = Array.from(activeMenu.querySelectorAll('[data-value]'));
        }
        if (optionsToSearch.length === 0) {
          optionsToSearch = Array.from(activeMenu.querySelectorAll('.vxx8jf'));
        }
        if (optionsToSearch.length > 0) {
          break;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Fallback 1: search globally for visible menus if private menu was not found/visible
    if (optionsToSearch.length === 0) {
      const menus = Array.from(document.querySelectorAll('.OA0qNb, .QXL7Te'));
      const visibleMenu = menus.find(el => {
        const hasOptions = el.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
        const style = window.getComputedStyle(el);
        return hasOptions && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (visibleMenu) {
        activeMenu = visibleMenu;
        optionsToSearch = Array.from(visibleMenu.querySelectorAll('[role="option"]'));
        if (optionsToSearch.length === 0) {
          optionsToSearch = Array.from(visibleMenu.querySelectorAll('[data-value]'));
        }
        if (optionsToSearch.length === 0) {
          optionsToSearch = Array.from(visibleMenu.querySelectorAll('.vxx8jf'));
        }
      }
    }
    
    // Fallback 2: Check inside the dropdownNode itself (preloaded options in closed state)
    if (optionsToSearch.length === 0) {
      optionsToSearch = Array.from(dropdownNode.querySelectorAll('[role="option"], [data-value], .vxx8jf'));
    }
    
    // Fallback 3: Document-wide fallback (if all else fails, query globally)
    if (optionsToSearch.length === 0) {
      const allOptions = Array.from(document.querySelectorAll('[role="option"], [data-value], .vxx8jf'));
      optionsToSearch = allOptions.filter(el => {
        if (el === dropdownNode) return false;
        // Verify parent container style if it's inside a menu
        const parentMenu = el.closest('.OA0qNb, .QXL7Te');
        if (parentMenu) {
          const style = window.getComputedStyle(parentMenu);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }

    writeLog("Dropdown Solver", `${blockContext}Found ${optionsToSearch.length} dropdown option elements. Matching with "${targetValue}"...`);
    console.log(`[FormAI] Found ${optionsToSearch.length} dropdown options to search`);

    let bestMatch = null;
    let bestMatchScore = 0; // 0: no match, 1: partial match, 2: exact match, 3: fuzzy match

    const normTarget = targetValue.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const opt of optionsToSearch) {
      const dv = (opt.getAttribute("data-value") || "").trim();
      const tx = (opt.innerText || opt.textContent || "").trim();
      const rawText = dv || tx;

      if (!rawText || rawText.toLowerCase() === "choose" || rawText.toLowerCase() === "select") continue;

      const normOption = rawText.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (normOption === normTarget) {
        bestMatch = opt;
        bestMatchScore = 2; // Exact
        break; // Exact match found, stop searching
      } else if (normOption.includes(normTarget) || normTarget.includes(normOption)) {
        if (bestMatchScore < 1) {
          bestMatch = opt;
          bestMatchScore = 1; // Substring
        }
      }
    }

    // Fallback: Fuzzy matching if no exact or substring match is found
    if (bestMatchScore === 0) {
      let highestSimilarity = 0;
      let fuzzyBestMatch = null;
      for (const opt of optionsToSearch) {
        const dv = (opt.getAttribute("data-value") || "").trim();
        const tx = (opt.innerText || opt.textContent || "").trim();
        const rawText = dv || tx;
        if (!rawText || rawText.toLowerCase() === "choose" || rawText.toLowerCase() === "select") continue;

        const normOption = rawText.toLowerCase().replace(/[^a-z0-9]/g, '');
        const similarity = PolymorphicFormRunner.getSimilarityScore(normOption, normTarget);
        if (similarity > highestSimilarity) {
          highestSimilarity = similarity;
          fuzzyBestMatch = opt;
        }
      }
      
      // If similarity is above 0.7 (70% match), accept it as a fuzzy match
      if (highestSimilarity >= 0.70 && fuzzyBestMatch) {
        bestMatch = fuzzyBestMatch;
        bestMatchScore = 3; // Fuzzy
        writeLog("Dropdown Solver", `${blockContext}Fuzzy match resolved: "${(bestMatch.innerText || bestMatch.textContent).trim()}" with similarity ${(highestSimilarity * 100).toFixed(1)}%`);
      }
    }

    if (bestMatch) {
      const matchText = bestMatch.innerText || bestMatch.textContent;
      writeLog("Dropdown Solver", `${blockContext}Selected match: "${matchText.trim()}" (score: ${bestMatchScore})`);
      console.log(`[FormAI] Matched dropdown option: "${matchText}" (score: ${bestMatchScore})`);
      
      // Scroll the option element itself into view using center alignment
      bestMatch.scrollIntoView({ behavior: "auto", block: "center" });
      await new Promise(r => setTimeout(r, 150));

      // Click the outer option container (bestMatch) directly
      const clickTarget = bestMatch;

      // Dispatch hover events to update internal state/focus
      const hoverOpts = { bubbles: true, cancelable: true, view: window };
      clickTarget.dispatchEvent(new PointerEvent('pointerover', hoverOpts));
      clickTarget.dispatchEvent(new MouseEvent('mouseover', hoverOpts));
      clickTarget.dispatchEvent(new PointerEvent('pointermove', hoverOpts));
      clickTarget.dispatchEvent(new MouseEvent('mousemove', hoverOpts));

      await new Promise(r => setTimeout(r, 50));

      // Dispatch click sequence
      if (clickTarget.isConnected) {
        this.triggerNaturalClick(clickTarget);
      }
      
      // Native click fallback specifically for dropdown options
      if (clickTarget.isConnected && typeof clickTarget.click === 'function') {
        clickTarget.click();
      }

      // Wait for the menu container to hide (close)
      // Query the latest active menu node again!
      const finalMenu = dropdownNode.querySelector('.OA0qNb, .QXL7Te') || activeMenu || (ownsId ? document.getElementById(ownsId) : null);
      if (finalMenu) {
        writeLog("Dropdown Solver", `${blockContext}Waiting for options menu container to close...`);
        let isClosed = false;
        for (let closeAttempt = 0; closeAttempt < 15; closeAttempt++) {
          const style = window.getComputedStyle(finalMenu);
          const hasOptions = finalMenu.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
          const isStillAttachedAndVisible = finalMenu.isConnected && hasOptions && style.display !== 'none' && style.visibility !== 'hidden';
          if (!isStillAttachedAndVisible) {
            isClosed = true;
            break;
          }
          await new Promise(r => setTimeout(r, 50));
        }

        if (!isClosed) {
          writeLog("Dropdown Warning", `${blockContext}Options menu did not close automatically. Forcing close...`);
          // Force close via Escape key
          dropdownNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await new Promise(r => setTimeout(r, 100));

          // Double check, if still open, toggle click the dropdown header
          const style = window.getComputedStyle(finalMenu);
          const hasOptions = finalMenu.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
          const isStillAttachedAndVisible = finalMenu.isConnected && hasOptions && style.display !== 'none' && style.visibility !== 'hidden';
          if (isStillAttachedAndVisible) {
            writeLog("Dropdown Warning", `${blockContext}Escape key failed. Toggling dropdown header to close...`);
            this.triggerNaturalClick(dropdownNode);
            await new Promise(r => setTimeout(r, 200));
          }
        }
      } else {
        await new Promise(r => setTimeout(r, 400));
      }
    } else {
      writeLog("Dropdown Warning", `${blockContext}Could not find a dropdown match for value: "${targetValue}"`);
      console.warn(`[FormAI] Could not find a dropdown match for: "${targetValue}"`);
      
      // Close dropdown by sending Escape and/or toggling the header
      const finalMenu = dropdownNode.querySelector('.OA0qNb, .QXL7Te') || activeMenu || (ownsId ? document.getElementById(ownsId) : null);
      if (finalMenu) {
        const style = window.getComputedStyle(finalMenu);
        const hasOptions = finalMenu.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
        const isStillAttachedAndVisible = finalMenu.isConnected && hasOptions && style.display !== 'none' && style.visibility !== 'hidden';
        if (isStillAttachedAndVisible) {
          dropdownNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await new Promise(r => setTimeout(r, 100));
          
          const style2 = window.getComputedStyle(finalMenu);
          const hasOptions2 = finalMenu.querySelectorAll('[role="option"], [data-value], .vxx8jf').length > 0;
          const isStillAttachedAndVisible2 = finalMenu.isConnected && hasOptions2 && style2.display !== 'none' && style2.visibility !== 'hidden';
          if (isStillAttachedAndVisible2) {
            writeLog("Dropdown Warning", `${blockContext}Escape key failed to close unmatched dropdown. Toggling header...`);
            this.triggerNaturalClick(dropdownNode);
            await new Promise(r => setTimeout(r, 200));
          }
        }
      } else {
        dropdownNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  static getLevenshteinDistance(s1, s2) {
    const m = s1.length;
    const n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }
    return dp[m][n];
  }

  static getSimilarityScore(s1, s2) {
    const maxLength = Math.max(s1.length, s2.length);
    if (maxLength === 0) return 1.0;
    const distance = this.getLevenshteinDistance(s1, s2);
    return 1.0 - (distance / maxLength);
  }
}
