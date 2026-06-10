const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'popup', 'popup.html');
let content = fs.readFileSync(filePath, 'utf8');

const profileStart = content.indexOf('<div class="view-pane hidden-pane flex flex-col h-full" id="view-profile">');
if (profileStart === -1) {
    console.error("Could not find view-profile pane.");
    process.exit(1);
}

const profileEnd = content.indexOf('<!-- Footer Meta -->');
if (profileEnd === -1) {
    console.error("Could not find Footer Meta.");
    process.exit(1);
}

const newProfileHTML = `
      <!-- ══════════════════════════════════════════ -->
      <!-- View: Profile (DB View) (BAUHAUS VERSION) -->
      <!-- ══════════════════════════════════════════ -->
      <div class="view-pane hidden-pane flex flex-col h-full overflow-y-auto bg-background" id="view-profile">
        
        <!-- Header Section -->
        <div class="p-6 relative shrink-0 border-b-4 border-primary">
          <div class="flex justify-between items-start">
            <div class="relative">
              <h1 class="text-4xl font-black uppercase tracking-tighter leading-none font-display text-primary">
                  USER<br>IDENTITY
              </h1>
              <div class="absolute -top-2 -right-3 w-6 h-6 bg-secondary border-4 border-primary rotate-12"></div>
            </div>
            <button id="edit-profile-btn" class="text-primary border-2 border-primary px-3 py-1 font-bold uppercase text-xs tracking-widest transition-colors flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#1a1a1a] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none bg-background hover:bg-surface-variant">
              <span class="material-symbols-outlined" style="font-size:14px;" id="edit-profile-icon">edit</span>
              <span id="edit-profile-text">Edit</span>
            </button>
          </div>
        </div>

        <div class="flex-grow p-5 space-y-6 relative">
          <!-- Loading skeleton -->
          <div id="db-profile-skeleton" class="space-y-6 hidden">
            <!-- Profile Image Skeleton -->
            <div class="h-48 w-full bg-primary/20 animate-pulse border-4 border-primary"></div>
            <div class="h-10 w-full bg-primary/20 animate-pulse"></div>
            <div class="h-10 w-full bg-primary/20 animate-pulse"></div>
            <div class="flex gap-4">
              <div class="h-10 w-1/2 bg-primary/20 animate-pulse"></div>
              <div class="h-10 w-1/2 bg-primary/20 animate-pulse"></div>
            </div>
          </div>

          <div id="db-profile-form" class="space-y-8 hidden">
            
            <!-- Profile Image Card -->
            <div class="relative group mt-2">
              <div class="absolute inset-0 bg-secondary translate-x-2 translate-y-2 border-4 border-primary"></div>
              <div class="relative bg-background border-4 border-primary overflow-hidden h-48">
                <img class="w-full h-full object-cover grayscale contrast-125" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCqTlDKan8TK9jlitEY-XsRwL9pLfigJKC6Y4q7uWcJO_VGF1UA77M62RwgBwiiLzlPehS_u2V1_lElVrhGPxBVspieORp2EbnReZt1R7jOc5D-0aOCXCLUJNYow_GzAl_1y3CxWzRmWan9ffzOUgY2AWeVRIX9Sa3Xio2YW2LOnkWfn4EGkiU4cGMW6t9PRO9qFy8dKv18YxY-tkoj4fXE8jPkyX9shKEZXUbpmVOqfziOLD_d1utHJTIk5RnLrbd10wPihhXMpw4">
                <div class="absolute bottom-0 left-0 right-0 bg-primary-fixed border-t-4 border-primary p-2">
                  <span class="font-headline font-black uppercase text-[10px]">Status: Active Member</span>
                </div>
              </div>
            </div>

            <!-- Form Fields -->
            <form class="space-y-6" onsubmit="return false;">
              <!-- Name & Email -->
              <div class="space-y-4">
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">01. Full Name</label>
                  <input id="db-name" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-lg font-headline font-bold focus:outline-none focus:border-tertiary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                </div>
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">02. Email</label>
                  <input id="db-email" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-tertiary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="email" disabled>
                </div>
              </div>

              <!-- College & Location -->
              <div class="space-y-4">
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">03. Institution</label>
                  <input id="db-college" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-secondary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="group">
                    <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">04. Location</label>
                    <input id="db-city" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-primary-fixed transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                  </div>
                  <div class="group">
                    <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">05. Branch</label>
                    <input id="db-branch" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-primary-fixed transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                  </div>
                </div>
              </div>

              <!-- Extra info grid -->
              <div class="grid grid-cols-2 gap-4">
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">06. Year</label>
                  <input id="db-year" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-secondary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                </div>
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">07. Phone</label>
                  <input id="db-phone" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-secondary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                </div>
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">08. DOB</label>
                  <input id="db-dob" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-secondary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                </div>
                <div class="group">
                  <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-1">09. PRN</label>
                  <input id="db-prn" class="db-profile-input w-full bg-transparent border-b-4 border-primary py-2 text-sm font-headline font-bold focus:outline-none focus:border-secondary transition-colors disabled:opacity-60 disabled:border-primary/40 disabled:text-primary/70 uppercase" type="text" disabled>
                </div>
              </div>

              <!-- Gender Selection -->
              <div class="group pt-2">
                <label class="block font-headline font-black uppercase text-[10px] tracking-widest mb-2">10. Gender Identity</label>
                <!-- We hide the actual value in a hidden input so the JS logic works the exact same way -->
                <input type="hidden" id="db-gender" class="db-profile-input">
                <div class="flex gap-2" id="db-gender-radios">
                  <label class="flex-1">
                    <input class="db-profile-radio hidden peer" name="gender-ui" type="radio" value="Male" disabled>
                    <div class="border-4 border-primary/40 peer-disabled:opacity-60 peer-not-disabled:border-primary p-2 text-center font-headline font-black uppercase text-[10px] cursor-pointer peer-checked:bg-primary peer-checked:text-background peer-checked:border-primary transition-all">Male</div>
                  </label>
                  <label class="flex-1">
                    <input class="db-profile-radio hidden peer" name="gender-ui" type="radio" value="Female" disabled>
                    <div class="border-4 border-primary/40 peer-disabled:opacity-60 peer-not-disabled:border-primary p-2 text-center font-headline font-black uppercase text-[10px] cursor-pointer peer-checked:bg-primary peer-checked:text-background peer-checked:border-primary transition-all">Female</div>
                  </label>
                  <label class="flex-1">
                    <input class="db-profile-radio hidden peer" name="gender-ui" type="radio" value="Non-Binary" disabled>
                    <div class="border-4 border-primary/40 peer-disabled:opacity-60 peer-not-disabled:border-primary p-2 text-center font-headline font-black uppercase text-[10px] cursor-pointer peer-checked:bg-primary peer-checked:text-background peer-checked:border-primary transition-all">Other</div>
                  </label>
                </div>
              </div>

              <div id="db-error" class="hidden text-error font-black text-[10px] uppercase tracking-widest mt-2 border-l-4 border-error pl-2"></div>
            </form>

            <!-- Auxiliary Information -->
            <div class="bg-tertiary-container border-4 border-primary p-4 mt-6 space-y-3">
              <h3 class="font-headline font-black uppercase text-sm tracking-tighter">Extension Stats</h3>
              <div class="space-y-2">
                <div class="flex justify-between border-b-2 border-primary/20 pb-1">
                  <span class="font-bold uppercase text-[10px] opacity-70">Uptime</span>
                  <span class="font-black text-xs">124.5H</span>
                </div>
                <div class="flex justify-between border-b-2 border-primary/20 pb-1">
                  <span class="font-bold uppercase text-[10px] opacity-70">Queries</span>
                  <span class="font-black text-xs">2,491</span>
                </div>
                <div class="flex justify-between border-b-2 border-primary/20 pb-1">
                  <span class="font-bold uppercase text-[10px] opacity-70">Efficiency</span>
                  <span class="font-black text-xs">98.2%</span>
                </div>
              </div>
            </div>

            <!-- Abstract Visual -->
            <div class="h-12 border-4 border-primary flex mt-6">
              <div class="flex-1 bg-secondary border-r-4 border-primary"></div>
              <div class="flex-1 bg-primary-fixed border-r-4 border-primary"></div>
              <div class="flex-1 bg-tertiary"></div>
            </div>

          </div>
        </div>

        <div id="db-save-container" class="shrink-0 p-5 bg-background border-t-4 border-primary hidden z-10 sticky bottom-0">
          <button id="save-profile-btn" class="w-full bg-primary text-background border-4 border-primary py-3 font-headline font-black uppercase text-xl hover:bg-tertiary neo-shadow active:translate-x-1 active:translate-y-1 active:shadow-[1px_1px_0px_0px_#1a1a1a] transition-all flex items-center justify-center gap-2">
            <span class="material-symbols-outlined" style="font-size:20px;">save</span>
            Save Profile
          </button>
        </div>

      </div>

    </main>
    
    `;

content = content.substring(0, profileStart - 10) + newProfileHTML + content.substring(profileEnd);
fs.writeFileSync(filePath, content, 'utf8');
console.log("Replaced view-profile with Bauhaus UI.");
