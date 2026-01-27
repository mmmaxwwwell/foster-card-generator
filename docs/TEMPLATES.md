# Template System Documentation

The foster-card-generator uses a flexible template system that allows you to create custom printable assets for foster animals. Templates are stored in the database and use Handlebars syntax for variable interpolation.

## Overview

Templates consist of two parts:
1. **HTML Template** - The visual layout using HTML/CSS with Handlebars placeholders
2. **Configuration Object** - Settings for rendering, preprocessing, and output

Template HTML files are stored in `app/templates/cards/` and loaded into the database via migrations.

## Built-in Templates

The application comes with three built-in templates:

### card-front
Business card front side (10 per page, letter landscape) displaying:
- Rescue organization logo and website
- Animal portrait photo
- Animal name, age, and breed

### card-back
Business card back side (10 per page, letter landscape) displaying:
- Animal slug/identifier
- QR code (auto-generated from slug)
- Animal details (age, gender, size, shots, housetrained, compatibility with kids/dogs/cats)

### adoption-flyer
Full-page adoption flyer (letter portrait, 8.5" × 11") displaying:
- Paw print decorative borders
- Rescue organization logo
- Large animal portrait photo
- "HAVE YOU SEEN [NAME]?" headline
- "Scan To Apply" section with QR code centered below photo
- Up to 16 custom attributes/personality traits in left column
- "ADOPTABLE" yellow badge
- Organization website footer

## Template Configuration Schema

```javascript
{
  // Page/output settings
  pageWidthInches: 11,        // Width in inches (e.g., 11 for letter landscape)
  pageHeightInches: 8.5,      // Height in inches (e.g., 8.5 for letter landscape)
  orientation: 'landscape',   // 'landscape' or 'portrait'
  paperSize: 'letter',        // 'letter', 'a4', or 'custom'
  dpi: 360,                   // Output DPI (dots per inch), default 360

  // Preprocessing options
  preprocessing: {
    generateQrCode: false,    // Generate QR code from slug/adoptionUrl
    qrCodeField: 'qrcode',    // Field name for QR code data URL (default 'qrcode')
    qrCodeSource: 'slug',     // Source field for QR data (default 'slug')
    convertBooleans: true,    // Convert boolean fields to emoji
    booleanFields: ['shots', 'housetrained'],  // Fields to convert (true/false → ✅/❌)
    triStateFields: ['kids', 'dogs', 'cats'],  // Fields with tri-state values
    preparePortrait: true,    // Copy portrait image to temp directory
    prepareLogo: true,        // Copy rescue logo to temp directory
  },

  // Output naming
  outputNamePattern: '{name}-{templateName}.png'  // Pattern for output filename
}
```

**Note:** The `repeatCount` option shown in examples is handled by the `{{#repeat N}}` Handlebars helper in the HTML template itself, not the config object.

## Available Template Variables

### Animal Data
| Variable | Description | Example |
|----------|-------------|---------|
| `name` | Animal's name | "Buddy" |
| `breed` | Animal's breed | "Golden Retriever Mix" |
| `ageShort` | Short age format | "2Y" |
| `ageLong` | Long age format | "2 Years" |
| `size` | Animal's size | "Large" |
| `gender` | Animal's gender | "Male" |
| `shots` | Vaccination status | ✅ or ❌ (after preprocessing) |
| `housetrained` | Housetrained status | ✅ or ❌ (after preprocessing) |
| `kids` | OK with kids | ✅, ❌, or ? (after preprocessing) |
| `dogs` | OK with dogs | ✅, ❌, or ? (after preprocessing) |
| `cats` | OK with cats | ✅, ❌, or ? (after preprocessing) |
| `slug` | Unique identifier | "buddy-123" |
| `portrait` | Portrait image path | Resolved path in temp directory |
| `portraitPath` | Portrait filename | "portrait.jpg" |
| `bio` | Animal description/bio text | "Buddy is a playful..." |
| `attributes` | Array of custom traits (max 16) | ["Leash Trained", "Loves Belly Rubs"] |

### Rescue Data
| Variable | Description | Example |
|----------|-------------|---------|
| `rescueName` | Organization name | "Paws Rescue League" |
| `rescueWebsite` | Organization website | "pawsrescueleague.org" |
| `logo` | Logo image path | Resolved path in temp directory |
| `rescueLogo` | Logo filename | "logo.png" |

### Generated Data
| Variable | Description | Notes |
|----------|-------------|-------|
| `qrcode` | QR code as data URL | Only if `generateQrCode: true` |
| `@index` | Loop iteration index | Available inside `{{#repeat}}` blocks |

## Creating a Custom Template

### Step 1: Design Your HTML Template

Create an HTML template using Handlebars syntax. The template **must include an element with `id="page"`** that will be captured as the output image.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My Custom Template</title>
    <style>
        body {
            margin: 0;
            padding: 0;
        }

        #page {
            width: 11in;
            height: 8.5in;
            background: white;
        }

        .card {
            /* Your card styling */
        }
    </style>
</head>
<body>
    <div id="page">
        {{#repeat 6}}
        <div class="card">
            <h2>{{name}}</h2>
            <p>{{breed}} - {{ageShort}}</p>
            <img src="{{portrait}}" alt="{{name}}">
        </div>
        {{/repeat}}
    </div>
</body>
</html>
```

**Important:** Use the `{{#repeat N}}` helper to repeat card content N times on the page. Inside the repeat block, variables are accessed directly (e.g., `{{name}}`) without the `../` prefix.

### Step 2: Define Configuration

Create a configuration object that matches your template's requirements:

```javascript
const myTemplateConfig = {
    pageWidthInches: 11,
    pageHeightInches: 8.5,
    orientation: 'landscape',
    paperSize: 'letter',
    dpi: 360,
    preprocessing: {
        generateQrCode: true,
        qrCodeField: 'qrcode',
        qrCodeSource: 'slug',
        convertBooleans: true,
        booleanFields: ['shots', 'housetrained'],
        triStateFields: ['kids', 'dogs', 'cats'],
        preparePortrait: true,
        prepareLogo: true
    },
    outputNamePattern: '{name}-my-template.png'
};
```

**Note:** The number of cards per page is controlled by the `{{#repeat N}}` helper in your HTML template, not the config.

### Step 3: Add to Database

Use the database API to add your template:

```javascript
const db = require('./app/db.js');

await db.initializeAsync();

db.createTemplate({
    name: 'my-custom-template',
    description: 'My custom business card layout',
    html_template: myHtmlTemplate,  // Your HTML string
    config: myTemplateConfig,
    is_builtin: false
});
```

### Database Template API

The following functions are available for template management:

| Function | Description |
|----------|-------------|
| `db.getAllTemplates()` | Returns array of all templates (without html_template for list view) |
| `db.getTemplateById(id)` | Get a template by ID with parsed config |
| `db.getTemplateByName(name)` | Get a template by name with parsed config |
| `db.createTemplate(template)` | Create a new template |
| `db.updateTemplate(id, template)` | Update an existing template |
| `db.deleteTemplate(id)` | Delete a template (built-in templates cannot be deleted) |

### Step 4: Generate Output

Use the template to generate assets:

```javascript
const { generateFromTemplate } = require('./app/generate-card-cli.js');

const template = db.getTemplateByName('my-custom-template');
const outputPath = await generateFromTemplate(template, animalParams);
```

You can also use the legacy API for the built-in card templates:

```javascript
const { generateCardFront, generateCardBack } = require('./app/generate-card-cli.js');

// Generate card front (uses 'card-front' template)
const frontPath = await generateCardFront(params);

// Generate card back (uses 'card-back' template)
const backPath = await generateCardBack(params);

// Optionally specify DPI (default is 360)
const hiResPath = await generateCardFront(params, 600);
```

## Handlebars Tips

### The `{{#repeat N}}` Helper

The application registers a custom `repeat` helper for repeating content:

```handlebars
{{#repeat 10}}
<div class="card" id="card{{@index}}">
    <h2>{{name}}</h2>
    <p>{{breed}}</p>
</div>
{{/repeat}}
```

Inside the `{{#repeat}}` block:
- Access variables directly: `{{name}}`, `{{breed}}`, etc.
- Use `{{@index}}` for the current iteration index (0-based)

### Conditional Rendering

```handlebars
{{#if qrcode}}
    <img src="{{qrcode}}" alt="QR Code">
{{/if}}
```

### Safe HTML Output

For HTML content that should not be escaped:

```handlebars
{{{htmlContent}}}
```

### The `{{tilde}}` Helper

A helper is available for wrapping content with tildes:

```handlebars
{{tilde name}}  <!-- Outputs: ~Buddy~ -->
```

## Preprocessing Pipeline

When a template is rendered via `generateFromTemplate()`, the following preprocessing steps occur:

1. **Temporary Directory Setup**
   - Creates a temp directory with prefix `foster-card-`
   - Creates `images/` subdirectory if `preparePortrait` is enabled

2. **Asset Preparation** (based on config)
   - If `preparePortrait: true`: Copies portrait image to `images/` in temp dir
   - If `prepareLogo: true`: Copies rescue logo to temp dir root

3. **QR Code Generation** (if `generateQrCode: true`)
   - Generates a data URL from the `qrCodeSource` field (default: `slug`)
   - Uses the local `qrcode` npm package (no web calls)
   - Stores result in the `qrCodeField` variable (default: `qrcode`)
   - Falls back to a placeholder SVG if generation fails

4. **Boolean Conversion** (if `convertBooleans: true`)
   - Converts `booleanFields` values: `true`/`1`/`'1'` → ✅, `false`/`0`/`'0'` → ❌
   - Converts `triStateFields` values: `true`/`1`/`'1'` → ✅, `false`/`0`/`'0'` → ❌, any other value → `?`

5. **Template Rendering**
   - Compiles HTML template with Handlebars
   - Writes rendered HTML to temp directory

6. **Screenshot Capture**
   - Launches Puppeteer browser
   - Sets viewport based on page dimensions and DPI
   - Captures the `#page` element
   - Resizes to exact target dimensions using Sharp
   - Embeds DPI metadata in output PNG

## Print Dialog Integration

When printing, the template's paper size and orientation are automatically applied:

- Paper size and orientation controls are locked (shown but disabled)
- A "Template Settings" info box displays the locked values
- Users can still adjust copies and paper source

## CLI Usage

The generator can be run from the command line:

```bash
# Generate card front (default)
node app/generate-card-cli.js '{"name":"Buddy","breed":"Lab Mix",...}'

# Generate card back
node app/generate-card-cli.js '{"name":"Buddy","slug":"buddy-123",...}' card-back

# Legacy 'front'/'back' arguments are supported
node app/generate-card-cli.js '{"name":"Buddy",...}' front
node app/generate-card-cli.js '{"name":"Buddy",...}' back

# Read params from stdin
echo '{"name":"Buddy",...}' | node app/generate-card-cli.js
```

The CLI outputs the path to the generated PNG file.

## Example: Single Large Card Template

```javascript
const singleCardConfig = {
    pageWidthInches: 8.5,
    pageHeightInches: 11,
    orientation: 'portrait',
    paperSize: 'letter',
    dpi: 300,
    preprocessing: {
        generateQrCode: true,
        convertBooleans: true,
        booleanFields: ['shots', 'housetrained'],
        triStateFields: ['kids', 'dogs', 'cats'],
        preparePortrait: true,
        prepareLogo: true
    },
    outputNamePattern: '{name}-poster.png'
};
```

And the corresponding HTML template would use `{{#repeat 1}}` for a single card.

## Example: Adoption Flyer Template

The built-in adoption flyer template demonstrates how to create a full-page format with custom attributes:

```javascript
const adoptionFlyerConfig = {
    pageWidthInches: 8.5,
    pageHeightInches: 11,
    orientation: 'portrait',
    paperSize: 'letter',
    dpi: 360,
    preprocessing: {
        generateQrCode: true,
        qrCodeField: 'qrcode',
        qrCodeSource: 'slug',
        convertBooleans: false,  // Uses custom attributes instead
        preparePortrait: true,
        prepareLogo: true
    },
    outputNamePattern: '{name}-adoption-flyer.png'
};
```

Key differences from card templates:
- Single item per page (`{{#repeat 1}}`)
- Portrait orientation for full-page layout
- Uses `attributes` array instead of boolean fields
- Larger QR code centered below photo

## Troubleshooting

### Template not rendering correctly
- Ensure an element with `id="page"` exists in your HTML - this is **required**
- Check that page dimensions in CSS match your config (`width: 11in; height: 8.5in;`)
- Verify all variables use correct Handlebars syntax (`{{variable}}` not `~variable~`)

### Images not showing
- Ensure `preparePortrait` and/or `prepareLogo` are enabled in preprocessing config
- Use correct variable paths: `{{portrait}}` for portraits, `{{logo}}` for logos
- Verify image data is being passed in params (`portraitData`/`portraitFilePath` and `rescueLogoData`)

### QR code not generating
- Enable `generateQrCode: true` in preprocessing config
- Ensure the `qrCodeSource` field (default: `slug`) exists in your params
- Check the console for error messages; a placeholder SVG is used on failure

### Output file not found
- Check `outputNamePattern` uses valid placeholders (`{name}` and `{templateName}`)
- Ensure the output directory is writable
- Output files are written to the configured output directory (see `app/paths.js`)

### DPI and print quality
- Default DPI is 360, suitable for high-quality printing
- Browsers render CSS inches at 96 DPI; the scale factor is calculated automatically
- Final output is resized to exact pixel dimensions using Sharp with DPI metadata embedded

## Database Schema

Templates are stored in the `templates` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key |
| `name` | TEXT | Unique template name |
| `description` | TEXT | Human-readable description |
| `html_template` | TEXT | Full HTML template with Handlebars syntax |
| `config` | TEXT | JSON-encoded configuration object |
| `is_builtin` | INTEGER | 1 for built-in templates (cannot be deleted) |
| `created_at` | TEXT | Creation timestamp |
| `updated_at` | TEXT | Last update timestamp (auto-updated via trigger) |
