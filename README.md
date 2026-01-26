# Foster Card Generator

**[View the website](https://mmmaxwwwell.github.io/foster-card-generator/)**

A Windows and Linux desktop application that helps animal rescue organizations create professional, printable trading card-style promotional materials for foster animals.

## Features

- **Animal Database Management** - Store and organize information about dogs and other animals available for adoption or fostering
- **Professional Card Generation** - Create high-quality (360 DPI) printable cards with animal photos, details, and QR codes linking to adoption profiles
- **Web Scraping Integration** - Automatically import animal information from Wagtopia and Adoptapet adoption websites
- **Advanced Print Management** - Printer profiles, calibration system, and custom paper settings for accurate printing
- **Multi-Rescue Support** - Manage animals from multiple rescue organizations

---

## Installation

### Download

1. Go to the [Releases](../../releases) page
2. Download the latest installer:
   - **`Foster Card Generator Setup X.X.X.exe`** - Standard installer (recommended)
   - **`Foster Card Generator-X.X.X-portable.exe`** - Portable version (no installation required)

### Install

1. Run the downloaded installer
2. Follow the installation wizard prompts
3. Choose your installation directory (or use the default)
4. Launch the application from the Start Menu or Desktop shortcut

### System Requirements

- Windows 10 or later (64-bit)
- 200 MB available disk space
- Internet connection (for web scraping features)
- **Google Chrome or Microsoft Edge** (recommended) - Used for web scraping. If not installed, the app will download a bundled browser (~200MB) on first use

---

## Getting Started

When you first launch the application, it will automatically set up the database with two default rescue organizations:
- **Paws Rescue League** (Wagtopia)
- **Brass City Rescue** (Adoptapet)

### Setting Up Rescue Logos

Each rescue organization needs a logo to display on the generated cards. **Brass City Rescue** requires manual logo setup due to website restrictions:

1. Visit the [Brass City Rescue website](https://www.brasscityrescue.org/) and download their logo
2. In the application, go to **Manage Rescues** from the menu
3. Select **Brass City Rescue** from the list
4. Click **Upload Logo** and select the downloaded logo file
5. Click **Save**

Without a logo, cards for Brass City Rescue animals will display a placeholder image.

### Adding Animals

You can add animals to your database in three ways:

#### Option 1: Manual Entry

1. Click **"Create New"** in the toolbar
2. Select **"Manual Entry"**
3. Fill in the animal's information:
   - Name, breed, age, size, gender
   - Vaccination status and house-training
   - Compatibility with kids, dogs, and cats
4. Upload a portrait photo
5. Click **Save**

#### Option 2: Scrape from URL

1. Click **"Create New"** in the toolbar
2. Select **"Scrape from URL"**
3. Paste the animal's profile URL from Wagtopia or Adoptapet
4. The application will automatically extract all available information
5. Review and edit the details if needed
6. Click **Save**

#### Option 3: Import from Rescue Organization

1. Click **"Create New"** in the toolbar
2. Select **"Select from Site"**
3. Choose a rescue organization from the dropdown
4. Click **Scrape** to fetch all available animals
5. Select which animals to import using the checkboxes
6. Click **Save Selected**

---

## Printing Cards

### Basic Printing

1. Find the animal you want to print in the grid view
2. Click **Print Front** to print the front side of the cards
3. In the Print Settings dialog:
   - Select your printer from the dropdown
   - Choose paper size, orientation, and number of copies
   - Select paper source if your printer has multiple trays
4. Wait for the front side to finish printing
5. Take the printed paper and place it back in the printer tray, flipped over (so the blank side faces up for printing) so we can print on the back of the cards
6. Click **Print Back** to print the back side of the cards

### Using Print Profiles

Print profiles save your printer settings so you don't have to configure them each time.

#### Saving a Profile

1. Configure your desired print settings
2. Enter a name in the **Profile Name** field
3. Click **Save Profile**

#### Loading a Profile

1. Select your printer
2. Choose a saved profile from the **Saved Profiles** dropdown
3. Settings will be automatically applied

#### Setting a Default Profile

1. Open **Manage Print Profiles** from the menu
2. Select the printer and profile
3. Click **Set as Default**

---

## Print Calibration

For professional-quality output, calibrate your printer to ensure cards printed at the correct size.

### Why Calibrate?

Cards are designed to print on **Avery 8471 Business Card** templates (10 cards per sheet). Different printers may slightly stretch, shrink, or offset printed content. Calibration ensures your cards align properly with the pre-cut card boundaries on the template sheets.

### Calibration Process

#### Step 1: Print the Calibration Test Page

1. Open **Manage Print Profiles**
2. Select your printer and profile
3. In the Calibration section, click **Print Calibration Test Page**
4. A test page with four reference dots (A, B, C, D) will print

#### Step 2: Measure the Printed Dots

Using a ruler, measure the distances between the dots in millimeters:
- **A to B** (top edge)
- **B to C** (right edge)
- **C to D** (bottom edge)
- **D to A** (left edge)

#### Step 3: Enter Measurements

1. Enter each measurement in the corresponding field
2. The application will calculate the necessary scale adjustments

#### Step 4: Edge Calibration

To ensure cards align with the Avery 8471 template boundaries:
1. Measure the white space from the paper edge to the printed border on each side
2. Enter the **Top**, **Right**, **Bottom**, and **Left** edge measurements

#### Step 5: Save

Click **Save Profile** to store the calibration data. Future prints will automatically apply these adjustments.

---

## Managing Animals

### Viewing Animals

- Animals are displayed in a responsive grid layout
- Each card shows the animal's photo, name, breed, and key details
- Compatibility badges indicate if the animal is good with kids, dogs, or cats

### Editing Animals

1. Click on an animal card to view details
2. Click **Edit** to modify the animal's information
3. Make your changes
4. Click **Save**

### Deleting Animals

1. Click on an animal card to view details
2. Click **Delete**
3. Confirm the deletion

---

## Card Design

Each generated card includes:

**Front of Card:**
- Rescue organization logo
- Rescue organization url
- Large animal portrait photo
- Animal's name
- Animal's age
- Animal's breed

**Back of Card:**
- Compatibility information (kids, dogs, cats)
- Vaccination and house-training status
- QR code linking to the animal's adoption profile

Cards are designed to print on [Avery 8471 Business Card](https://www.amazon.com/Avery-Printable-Business-Printers-Heavyweight/dp/B00006HQU9) templates (10 cards per sheet, US Letter size) at 360 DPI for professional print quality.

---

## Data Storage

All data is stored locally on your computer:

- **Database Location:** `C:\Users\{YourUsername}\AppData\Local\foster-card-generator\`
- **Generated Cards:** `C:\Users\{YourUsername}\AppData\Local\foster-card-generator\output\`

Your data is never uploaded to external servers.

---

## Troubleshooting

### Application won't start

- Ensure you're running Windows 10 or later (64-bit)
- Try running as Administrator
- Reinstall the application

### Web scraping not working

- Check your internet connection
- The adoption website may have changed its layout - try manual entry instead
- Some animals may not have all fields available on the source website

### Prints are the wrong size

- Run the calibration process for your printer
- Ensure you've selected the correct paper size
- Check that your printer's own settings aren't applying additional scaling

### Cards look blurry when printed

- Ensure you're using high-resolution source images
- Check your printer's quality settings
- Make sure you're printing at the intended paper size

### Database errors

1. Close the application
2. Navigate to `C:\Users\{YourUsername}\AppData\Local\foster-card-generator\`
3. Delete the database file
4. Restart the application (a fresh database will be created)

**Note:** This will delete all your saved animals and print profiles.

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Refresh | `F5` |
| Developer Tools | `Ctrl+Shift+I` |

---

## Support

For bug reports and feature requests, please visit the [Issues](../../issues) page on GitHub.

---

## License

MIT License
