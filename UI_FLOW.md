# UI Flow Documentation

Machine-readable UI specification for Preact+HTM migration.

## Architecture

- Entry: `main.js` (Electron main), `app/resources/index.html` (single HTML), `app/resources/js/app.js` (3131 lines vanilla JS)
- No preload.js - uses `nodeIntegration: true`
- DB: sql.js via `app/db.js` (sync calls)
- IPC: `ipcRenderer.invoke()` for async main process ops

## State Variables

```js
let animals = []                    // Animal[] from DB
let rescues = []                    // Rescue[] from DB
let currentAnimal = null            // Animal being edited
let pendingImageData = null         // Image hex/mime/path for edit mode
let newAnimalImageData = null       // Image hex/mime/path for create mode
let scrapedAnimals = []             // [{name,url}] from list scraper
let selectedAnimalUrls = new Set()  // URLs selected for import
let selectedDeleteAnimalIds = new Set()
let selectedPrintAnimalIds = new Set()
let cardGenerationQueue = []        // [{animalId}]
let isProcessingQueue = false
let cachedPrinters = null           // Printer[]
let cachedProfiles = {}             // {printerName: Profile[]}
let currentPrintFilePath = null
let currentPrintCallback = null
let currentEditProfileId = null     // null=new, number=edit
let saveProfileSource = ''          // 'printSettings'|'manage'
let currentEditRescue = null
let pendingRescueLogoData = null
let selectedRescue = ''             // 'wagtopia'|'adoptapet'
```

## Data Structures

### Animal
```ts
{id:number, name:string, breed:string, slug:string, age_long:string, age_short:string, size:'Small'|'Medium'|'Large', gender:string, shots:boolean, housetrained:boolean, kids:'1'|'0'|'?', dogs:'1'|'0'|'?', cats:'1'|'0'|'?', rescue_id:number, imageDataUrl:string, bio:string, attributes:string[]}
```

### ImageData (hex for DB storage)
```ts
{hex:string, mime:string, path:string}
```

### PrintProfile
```ts
{id:number, name:string, printer_name:string, copies:number, paper_size:'letter'|'legal'|'A4'|'A5', orientation:'landscape'|'portrait', paper_source:'default'|'rear', is_default:boolean, calibration_ab?:number, calibration_bc?:number, calibration_cd?:number, calibration_da?:number, border_top?:number, border_right?:number, border_bottom?:number, border_left?:number}
```

### Rescue
```ts
{id:number, name:string, website?:string, org_id?:string, scraper_type?:'wagtopia'|'adoptapet', logo_path?:string, logo_data?:string, logo_mime?:string}
```

### Template
```ts
{id:number, name:string, description:string, html_template:string, config:TemplateConfig, is_builtin:boolean, created_at:string, updated_at:string}
```

### Setting
```ts
{key:string, value:string, created_at:string, updated_at:string}
```

## Screens

### 1. MainScreen (default)

**Elements:**
- Header: "Foster Animals" + subtitle showing count
- Buttons: CreateAnimal, Refresh, PrintMultiple, DeleteMultiple, Settings
- Grid: AnimalCards (auto-fill 280px min)

**AnimalCard:**
- Image container (placeholder "🐕" if no image)
- Rescue logo badge (bottom-right corner)
- Info: name, breed, age, size, gender, shots
- Badges: Kids/Dogs/Cats (Yes/No/Unknown via `formatCompatibility`)
- Buttons: "Print Front" (purple gradient), "Print Back" (gray)
- Click name/image → openEditModal(id)

**Init:**
```js
// DOMContentLoaded
setupPaths()      // init DB, dirs, logging
loadAnimals()     // db.getAllAnimals(), db.getAllRescues(), render grid
loadCalibrationInfo()
```

**Actions:**
| Button | Handler | Effect |
|--------|---------|--------|
| Create Animal | openCreateModal() | show createModal |
| Refresh | loadAnimals() | reload grid |
| Print Multiple | openPrintMultipleModal() | show printMultipleModal |
| Delete Multiple | openDeleteMultipleModal() | show deleteMultipleModal |
| Settings | openSettingsModal() | show settingsModal |
| Print Front | printCardFront(id) | generate card → print flow |
| Print Back | printCardBack(id) | generate card → print flow |

---

### 2. CreateModal

**Elements:**
- 3 option buttons

**Actions:**
| Button | Handler |
|--------|---------|
| Enter Data | openManualEntryModal() |
| Scrape from URL | openScrapeModal() |
| Select from Site | openRescueSelectModal() |

---

### 3. RescueSelectModal

**Elements:**
- 2 buttons: "Paws Rescue League", "Brass City Rescue"

**Actions:**
| Button | Handler |
|--------|---------|
| Paws Rescue League | selectRescue('wagtopia') → openSelectFromSiteModal() |
| Brass City Rescue | selectRescue('adoptapet') → openSelectFromSiteModal() |

---

### 4. ScrapeModal

**Elements:**
- Input: scrapeUrl (text)
- Buttons: Cancel, Scrape Data

**Actions:**
| Button | Handler | IPC |
|--------|---------|-----|
| Scrape Data | scrapeUrl() | `scrape-animal-page-{wagtopia\|adoptapet}` |
| Cancel | closeScrapeModal() | - |

**Flow:** scrapeUrl() → IPC returns {name,breed,slug,age_long,age_short,size,gender,shots,housetrained,kids,dogs,cats,imagePath} → loads image to newAnimalImageData → openManualEntryModalWithData(data)

---

### 5. ManualEntryModal (Create)

**Elements:**
- Image upload (click placeholder or img to trigger hidden file input #newAnimalImageInput)
- Inputs: name, breed, slug, ageLong, ageShort
- Selects: size (Small/Medium/Large), gender, shots (Yes/No), housetrained (Yes/No), kids/dogs/cats (Yes/No/Unknown), rescue (dynamic from DB)
- Buttons: Cancel, Create Animal

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Image click | triggers #newAnimalImageInput | file dialog |
| File selected | handleNewAnimalImageSelected(e) | read file→hex, store in newAnimalImageData, show preview |
| Create Animal | createAnimal() | db.createAnimal(data, imageData), loadAnimals() |
| Cancel | closeManualEntryModal() | clear newAnimalImageData, close |

---

### 6. EditModal

**Elements:**
- Same as ManualEntryModal but pre-filled
- Hidden input: animalId
- Image stored in pendingImageData
- Bio textarea for animal description
- Attributes section (16 inputs for custom traits)
- AI Edit Image button (overlay on image hover)
- Generate Attributes button (requires OpenAI API key)
- Buttons: Delete, Cancel, Save Changes

**Open:** openEditModal(id) → finds animal in `animals`, sets `currentAnimal`, populates form

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Image change | handleEditImageSelected(e) | store in pendingImageData |
| AI Edit Image | openAIEditModal() | open AI image editing modal |
| Generate Attributes | generateAttributes() | call OpenAI API to generate attributes from bio |
| Save Changes | saveAnimal() | db.updateAnimal(id, data, pendingImageData) |
| Delete | deleteAnimal() | confirm → db.deleteAnimal(id) |
| Cancel | closeModal() | clear currentAnimal, pendingImageData |

---

### 6a. AIEditImageModal

**Elements:**
- Preview of current image
- Textarea for edit prompt/description
- Examples text: "Make the background a sunny park, remove the leash..."
- Buttons: Cancel, Generate, Save (after generation)

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Generate | callOpenAIImageEdit() | send image + prompt to OpenAI API |
| Save | handleAIEditSave() | apply edited image to animal |
| Cancel | closeAIEditModal() | discard changes |

---

### 7. SelectFromSiteModal

**Elements:**
- Loading spinner (initial)
- Select All checkbox
- Scrollable list of animals with checkboxes
- Buttons: Cancel, Import Selected

**Open:** openSelectFromSiteModal() → IPC `scrape-animal-list-{selectedRescue}` → stores in scrapedAnimals → renderAnimalSelectionList()

**IPC:**
- wagtopia: `scrape-animal-list-wagtopia(orgId)` → [{name,url}]
- adoptapet: `scrape-animal-list-adoptapet(shelterId)` → [{name,url}]

**Actions:**
| Action | Handler |
|--------|---------|
| Checkbox toggle | toggleAnimalSelection(url) → add/remove from selectedAnimalUrls |
| Select All | toggleSelectAll() |
| Import Selected | importSelectedAnimals() |

**importSelectedAnimals():** For each url in selectedAnimalUrls:
1. scrapeAnimalPage(url) → IPC scrape individual
2. Read temp image file → hex
3. db.createAnimal(data, imageData)
4. Cleanup temp file
5. Show toast with success/fail count

---

### 8. DeleteMultipleModal

**Elements:**
- Select All checkbox
- Grid of 150×150 thumbnails with checkboxes
- Buttons: Cancel, Delete Selected (shows count)

**State:** selectedDeleteAnimalIds (Set)

**Actions:**
| Action | Handler |
|--------|---------|
| Thumbnail checkbox | toggleDeleteAnimal(id) |
| Select All | toggleDeleteSelectAll() |
| Delete Selected | deleteSelectedAnimals() → confirm → db.deleteAnimals([...ids]) |

---

### 9. PrintMultipleModal

**Elements:** Same as DeleteMultipleModal

**State:** selectedPrintAnimalIds (Set)

**Actions:**
| Action | Handler |
|--------|---------|
| Print Selected | adds each to cardGenerationQueue, processCardGenerationQueue() |

**Queue:** processCardGenerationQueue() processes sequentially: printCardFront(id) → print dialog → printCardBack(id) → print dialog → next

---

### 10. PrintSettingsModal

**Elements:**
- Preview image
- Select: printer (from IPC get-printers)
- Select: profile (from IPC get-print-profiles)
- Input: copies (1-99)
- Select: paperSize (Letter/Legal/A4/A5)
- Radio: orientation (Landscape/Portrait)
- Select: paperSource (Default/Rear Tray)
- Status message area
- Buttons: Cancel, Print

**Open:** openPrintSettingsModal(filePath, callback) → loads printers → shows preview

**IPC:**
- `get-printers` → {success, printers:[{name,isDefault}]}
- `get-print-profiles(printerName)` → {success, profiles:[Profile]}

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Printer change | onPrinterChange() | loadPrintProfiles(name), apply default |
| Profile change | onProfileChange() | applyPrintProfile(profile) |
| Print | confirmPrint() | IPC `print-image(filePath, options)` |
| Cancel | closePrintSettingsModal() | call currentPrintCallback(false) |

**Print options include:** printer, copies, paperSize, orientation, paperSource, calibration_ab/bc/cd/da, border_top/right/bottom/left

---

### 11. ManageProfilesModal

**Elements:**
- Select: printer
- Profile list (each shows: name, settings summary, badges Default/Calibrated, buttons)
- Profile buttons: Set Default, Copy, Edit, Delete
- Footer buttons: New Profile, Close

**Actions:**
| Action | Handler | IPC |
|--------|---------|-----|
| Printer change | loadProfilesForManagement() | get-print-profiles |
| Set Default | setProfileAsDefault(id) | set-default-print-profile |
| Copy | copyProfile(id) | save-print-profile (with " (Copy)" suffix) |
| Edit | openEditProfileDialog(id) | - |
| Delete | deleteProfile(id) | delete-print-profile |
| New Profile | openSaveProfileDialogFromManage() | - |

---

### 12. SaveProfileModal

**Elements:**
- Input: profileName
- Input: copies
- Select: paperSize
- Radio: orientation
- Select: paperSource
- Collapsible calibration section:
  - Button: Print test page (Windows only)
  - Inputs: calibration_ab/bc/cd/da (distance between dots)
  - Inputs: border_top/right/bottom/left
  - Button: Clear Calibration
  - Badge: Calibrated/Not Calibrated
- Checkbox: setAsDefault
- Buttons: Cancel, Save Profile

**Modes:**
- New from print settings: saveProfileSource='printSettings', currentEditProfileId=null
- New from manage: saveProfileSource='manage', currentEditProfileId=null
- Edit: saveProfileSource='manage', currentEditProfileId=id

**IPC:**
- `print-calibration-page(options)` → prints test page
- `save-print-profile(profileData)` → saves to DB

---

### 13. ManageRescuesModal

**Elements:**
- List of rescues (logo 40×40, name, website, scraper type, Edit button)
- Buttons: Add New Rescue, Close

**Actions:**
| Action | Handler |
|--------|---------|
| Edit | openEditRescueModal(id) |
| Add New Rescue | openAddRescueModal() |

---

### 14. EditRescueModal

**Elements:**
- Logo upload (click to change, 120px height preview)
- Input: name (required)
- Input: website
- Input: orgId
- Select: scraperType (None/Wagtopia/Adoptapet)
- Buttons: Delete (edit mode only), Cancel, Save Rescue

**State:** currentEditRescue, pendingRescueLogoData

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Logo change | handleRescueLogoSelected(e) | store in pendingRescueLogoData |
| Save Rescue | saveRescue() | db.createRescue or db.updateRescue |
| Delete | deleteCurrentRescue() | db.deleteRescue(id) |

---

### 15. SettingsModal

**Elements:**
- Three main setting buttons (open sub-modals):
  - Rescue Organizations → ManageRescuesModal
  - Print Profiles → ManageProfilesModal
  - Card Templates → ManageTemplatesModal
- OpenAI API Key section (expandable):
  - Password input with show/hide toggle
  - Link to get API key
  - Save button
- Close button

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Rescue Organizations | openManageRescuesModal() | open rescues sub-modal |
| Print Profiles | openManageProfilesFromMain() | open profiles sub-modal |
| Card Templates | openManageTemplatesModal() | open templates sub-modal |
| Save API Key | saveOpenAIKey() | db.setSetting('openai_api_key', value) |

---

### 16. ManageTemplatesModal

**Elements:**
- List of templates (name, description, badges for Built-in)
- Edit button for each template
- Add New Template button (custom templates only)
- Close button

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Edit | openEditTemplateModal(id) | open template editor |
| Add New Template | openAddTemplateModal() | create new custom template |

---

### 17. EditTemplateModal

**Elements:**
- Input: name (readonly for built-in)
- Input: description
- Textarea: HTML template (Handlebars syntax)
- Config editor: page size, orientation, DPI, preprocessing options
- Buttons: Delete (custom only), Cancel, Save

**Actions:**
| Action | Handler | Effect |
|--------|---------|--------|
| Save | saveTemplate() | db.updateTemplate or db.createTemplate |
| Delete | deleteTemplate() | db.deleteTemplate (custom only) |

---

## IPC Channels

### DB Operations (via app/db.js - sync)
```
// Animals
db.getAllAnimals()
db.getImageAsDataUrl(id)
db.createAnimal(data, imageData)
db.updateAnimal(id, data, imageData)
db.deleteAnimal(id)
db.deleteAnimals(ids[]) → {successCount, failCount}
db.getAnimalAttributes(id) → string[]
db.updateAnimalAttributes(id, attributes[])

// Rescues
db.getAllRescues()
db.getRescueById(id)
db.getRescueByScraperType(type)
db.createRescue(data, logoData)
db.updateRescue(id, data, logoData)
db.deleteRescue(id)

// Templates
db.getAllTemplates() → Template[] (without html_template)
db.getTemplateById(id) → Template (with parsed config)
db.getTemplateByName(name) → Template (with parsed config)
db.createTemplate(template)
db.updateTemplate(id, template)
db.deleteTemplate(id) // cannot delete built-in

// Settings
db.getSetting(key) → value
db.setSetting(key, value)
db.getAllSettings() → Setting[]
db.deleteSetting(key)
```

### Main Process IPC (via ipcRenderer.invoke)
```
get-printers → {success, printers:[{name,isDefault}]}
get-print-profiles(printerName) → {success, profiles:[Profile]}
get-print-profile(id) → {success, profile:Profile}
get-default-print-profile(printerName) → {success, profile:Profile|null}
save-print-profile(profileData) → {success, id}
delete-print-profile(id) → {success}
set-default-print-profile(id) → {success}
print-image(filePath, options) → {success}
print-calibration-page(options) → {success, path}
open-in-gimp(filePath) → {success}
get-calibration-info → calibration constants
scrape-animal-page-wagtopia(url) → {success, data:{...animal fields, imagePath}}
scrape-animal-page-adoptapet(url) → {success, data:{...animal fields, imagePath}}
scrape-animal-list-wagtopia(orgId) → {success, data:[{name,url}]}
scrape-animal-list-adoptapet(shelterId) → {success, data:[{name,url}]}
```

---

## Modal Open/Close

All modals: click overlay (outside content) → close
Escape key → close all modals

```js
// Generic pattern
openXModal()   // add 'active' class to modal element
closeXModal()  // remove 'active' class, clear related state
```

---

## Utility Functions

```js
formatCompatibility(val) // '1'→'Yes', '0'→'No', '?'→'Unknown'
getPaperSizeLabel(size)  // 'letter'→'Letter (8.5" × 11")'
capitalizeFirst(str)
escapeHtml(text)
showToast(msg, type='success'|'error') // 3s auto-dismiss, bottom-right
```

---

## Print Flow

### Single Card
1. Click "Print Front/Back" → printCardFront/Back(id)
2. Extract base64 from imageDataUrl → write temp file
3. generateCardFront/Back(params) → output PNG
4. Cleanup temp
5. Windows: openPrintSettingsModal(path, callback)
6. Linux/macOS: IPC `open-in-gimp`
7. User configures, clicks Print → IPC `print-image`

### Multiple Cards
1. Select animals in printMultipleModal
2. Click Print → add all to cardGenerationQueue
3. processCardGenerationQueue() → sequential: front dialog → back dialog → next animal

---

## Component Tree (suggested Preact)

```
App
├── Header
├── ControlBar (Create, Refresh, PrintMultiple, DeleteMultiple, Settings)
├── AnimalGrid
│   └── AnimalCard[] (image, info, badges, print buttons)
├── CreateModal
├── RescueSelectModal
├── ScrapeModal
├── ManualEntryModal (create mode)
├── EditModal (edit mode)
│   └── AIEditImageModal (AI image editing)
├── SelectFromSiteModal
├── DeleteMultipleModal
├── PrintMultipleModal
├── PrintSettingsModal
├── SettingsModal
│   ├── ManageRescuesModal
│   │   └── EditRescueModal
│   ├── ManageProfilesModal
│   │   └── SaveProfileModal
│   └── ManageTemplatesModal
│       └── EditTemplateModal
└── Toast (notifications)
```

---

## CSS Classes (key patterns)

- `.modal` + `.active` for visibility
- `.animal-card` for grid items
- `.control-bar` for button row
- `.rescue-logo-badge` positioned bottom-right
- `.compatibility-badge.yes|no|unknown` for colored badges
- `.toast.success|error` for notifications
