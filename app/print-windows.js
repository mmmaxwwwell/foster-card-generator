const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const sharp = require('sharp');

// Calibration constants
// The test page has 4 dots arranged in a square, 100mm apart (expected distance)
const CALIBRATION_EXPECTED_DISTANCE_MM = 100;

// Default print DPI
const PRINT_DPI = 360;
// Default page dimensions (US Letter landscape) - used for calibration page
const PAGE_WIDTH_PX = Math.round(11 * PRINT_DPI);  // 3960 pixels (landscape width)
const PAGE_HEIGHT_PX = Math.round(8.5 * PRINT_DPI); // 3060 pixels (landscape height)

// Conversion constants
const MM_PER_INCH = 25.4;

/**
 * Convert millimeters to pixels at print DPI
 * @param {number} mm - Value in millimeters
 * @returns {number} - Value in pixels
 */
function mmToPixels(mm) {
    return Math.round((mm / MM_PER_INCH) * PRINT_DPI);
}

/**
 * Calculate calibration scale factors from measured distances
 * @param {object} measured - Measured distances { ab, bc, cd, da } in mm
 * @returns {object} - Calibration data { scaleX, scaleY, avgScale, isCalibrated }
 */
function calculateCalibration(measured) {
    const expected = CALIBRATION_EXPECTED_DISTANCE_MM;

    // Validate input
    if (!measured || !measured.ab || !measured.bc || !measured.cd || !measured.da) {
        return { scaleX: 1, scaleY: 1, avgScale: 1, isCalibrated: false };
    }

    // A-B and C-D are horizontal (X axis)
    // B-C and D-A are vertical (Y axis)
    const horizontalAvg = (measured.ab + measured.cd) / 2;
    const verticalAvg = (measured.bc + measured.da) / 2;

    // Scale factor = expected / measured
    // If printed smaller than expected, scale > 1 (need to enlarge)
    // If printed larger than expected, scale < 1 (need to shrink)
    const scaleX = expected / horizontalAvg;
    const scaleY = expected / verticalAvg;
    const avgScale = (scaleX + scaleY) / 2;

    console.log('[PrintWindows] Calibration calculated:');
    console.log(`  Horizontal measured avg: ${horizontalAvg}mm, scaleX: ${scaleX.toFixed(4)}`);
    console.log(`  Vertical measured avg: ${verticalAvg}mm, scaleY: ${scaleY.toFixed(4)}`);
    console.log(`  Average scale: ${avgScale.toFixed(4)}`);

    return {
        scaleX,
        scaleY,
        avgScale,
        isCalibrated: true
    };
}

/**
 * Get calibration scales from profile calibration values
 * @param {object} profile - Print profile with calibration_ab, calibration_bc, etc.
 * @returns {object} - { scaleX, scaleY, isCalibrated }
 */
function getCalibrationFromProfile(profile) {
    if (!profile) {
        return { scaleX: 1, scaleY: 1, isCalibrated: false };
    }

    const ab = profile.calibration_ab;
    const bc = profile.calibration_bc;
    const cd = profile.calibration_cd;
    const da = profile.calibration_da;

    if (!ab || !bc || !cd || !da) {
        return { scaleX: 1, scaleY: 1, isCalibrated: false };
    }

    return calculateCalibration({ ab, bc, cd, da });
}

/**
 * Apply calibration and border adjustments to a PNG image
 *
 * The calibration system works as follows:
 * 1. Scale calibration: If the printer prints at wrong size (e.g., 98mm instead of 100mm),
 *    we scale the image to compensate (e.g., multiply by 100/98 = 1.0204)
 * 2. Border calibration: If the printer adds margins, we need to:
 *    - Reduce the effective printable area
 *    - Position our content to account for the printer's margins
 *
 * @param {string} inputPath - Path to the source PNG image
 * @param {string} outputPath - Path for the processed PNG
 * @param {object} options - Processing options
 * @param {object} options.calibration - { ab, bc, cd, da } raw measurements or { scaleX, scaleY }
 * @param {object} options.borderCalibration - { top, right, bottom, left } in mm
 * @param {number} options.pageWidthInches - Page width in inches (from template config)
 * @param {number} options.pageHeightInches - Page height in inches (from template config)
 * @returns {Promise<string>} - Path to the processed PNG
 */
async function applyCalibrationToPng(inputPath, outputPath, options = {}) {
    console.log('[PrintWindows] Processing PNG with calibration:', inputPath);
    console.log('[PrintWindows] Output:', outputPath);

    // Determine page dimensions from options or source image
    // The template config should specify the page size
    let targetPageWidthPx, targetPageHeightPx;
    if (options.pageWidthInches && options.pageHeightInches) {
        targetPageWidthPx = Math.round(options.pageWidthInches * PRINT_DPI);
        targetPageHeightPx = Math.round(options.pageHeightInches * PRINT_DPI);
        console.log(`[PrintWindows] Using template page size: ${options.pageWidthInches}" x ${options.pageHeightInches}"`);
    } else {
        // Fall back to reading the source image dimensions
        // The source image is already generated at the correct size by generate-card-cli.js
        const sourceMetadata = await sharp(inputPath).metadata();
        targetPageWidthPx = sourceMetadata.width;
        targetPageHeightPx = sourceMetadata.height;
        console.log('[PrintWindows] Using source image dimensions as page size');
    }
    console.log(`[PrintWindows] Target page size: ${targetPageWidthPx} x ${targetPageHeightPx} px`);

    // Get calibration scale factors
    let calibrationScaleX = 1;
    let calibrationScaleY = 1;

    if (options.calibration) {
        let calibData = options.calibration;
        // If we have raw measurements, calculate scales
        if (calibData.ab && calibData.bc && calibData.cd && calibData.da) {
            const calc = calculateCalibration({
                ab: calibData.ab,
                bc: calibData.bc,
                cd: calibData.cd,
                da: calibData.da
            });
            calibrationScaleX = calc.scaleX;
            calibrationScaleY = calc.scaleY;
        } else if (calibData.scaleX && calibData.scaleY) {
            calibrationScaleX = calibData.scaleX;
            calibrationScaleY = calibData.scaleY;
        }
        console.log('[PrintWindows] Calibration scales: X=', calibrationScaleX.toFixed(4), ', Y=', calibrationScaleY.toFixed(4));
    }

    // Calculate border offsets in pixels
    // The user measures the white space between paper edge and the black border
    // Expected value is BORDER_INSET_MM (5mm). If they measure more, printer adds margin.
    // If they measure less, printer cuts into the margin.
    // We calculate the printer's actual margin: measured - expected = printer's extra margin
    // A positive value means the printer adds margin, negative means it clips.
    let borderTopPx = 0;
    let borderRightPx = 0;
    let borderBottomPx = 0;
    let borderLeftPx = 0;

    if (options.borderCalibration) {
        const bc = options.borderCalibration;
        // Convert measured white space to compensation offset
        // Formula: compensation = expected - measured
        // If user measures 7mm and expected is 5mm, printer adds 2mm margin -> we shift content 2mm TOWARD that edge
        // If user measures 3mm and expected is 5mm, printer clips 2mm -> we shift content 2mm AWAY from that edge
        // A positive compensation means we need to shift content toward that edge (printer added margin)
        // A negative compensation means we need to shift content away from that edge (printer clipped)
        const topCompensation = (bc.top !== null && bc.top !== undefined) ? (BORDER_INSET_MM - bc.top) : 0;
        const rightCompensation = (bc.right !== null && bc.right !== undefined) ? (BORDER_INSET_MM - bc.right) : 0;
        const bottomCompensation = (bc.bottom !== null && bc.bottom !== undefined) ? (BORDER_INSET_MM - bc.bottom) : 0;
        const leftCompensation = (bc.left !== null && bc.left !== undefined) ? (BORDER_INSET_MM - bc.left) : 0;

        borderTopPx = mmToPixels(topCompensation);
        borderRightPx = mmToPixels(rightCompensation);
        borderBottomPx = mmToPixels(bottomCompensation);
        borderLeftPx = mmToPixels(leftCompensation);
        console.log('[PrintWindows] Border calibration - measured (mm):', bc);
        console.log('[PrintWindows] Border calibration - expected inset:', BORDER_INSET_MM, 'mm');
        console.log('[PrintWindows] Border calibration - compensation (mm): top=', topCompensation, ', right=', rightCompensation,
                    ', bottom=', bottomCompensation, ', left=', leftCompensation);
        console.log('[PrintWindows] Border calibration - compensation (px): top=', borderTopPx, ', right=', borderRightPx,
                    ', bottom=', borderBottomPx, ', left=', borderLeftPx);
    }

    // Read the source image
    const sourceImage = sharp(inputPath);
    const metadata = await sourceImage.metadata();
    console.log('[PrintWindows] Source image:', metadata.width, 'x', metadata.height, 'px');

    // Scale calibration explanation:
    // - If printer prints 98mm when we expect 100mm, scaleX = 100/98 = 1.0204
    // - This means the printer shrinks by ~2%
    // - To compensate, we make our image larger by ~2% so when printer shrinks it, output is correct
    //
    // The source image is designed to fill the page area at the specified DPI.
    // We apply calibration scaling to pre-compensate for printer distortion.
    // Border calibration only affects POSITION, not size.

    // Calculate scale to fit source image to page while maintaining aspect ratio
    const fitScaleX = targetPageWidthPx / metadata.width;
    const fitScaleY = targetPageHeightPx / metadata.height;
    const fitScale = Math.min(fitScaleX, fitScaleY);

    // Apply calibration scaling on top of fit scaling
    // If scaleX > 1, printer shrinks output, so we make image larger
    const scaledWidth = Math.round(metadata.width * fitScale * calibrationScaleX);
    const scaledHeight = Math.round(metadata.height * fitScale * calibrationScaleY);

    console.log('[PrintWindows] Fit scale:', fitScale.toFixed(4));
    console.log('[PrintWindows] Scaled image size (with calibration):', scaledWidth, 'x', scaledHeight, 'px');

    // Ensure the scaled image doesn't exceed page dimensions
    // (this could happen with extreme calibration values)
    const finalWidth = Math.min(scaledWidth, targetPageWidthPx);
    const finalHeight = Math.min(scaledHeight, targetPageHeightPx);

    if (finalWidth !== scaledWidth || finalHeight !== scaledHeight) {
        console.log('[PrintWindows] Clamped to page size:', finalWidth, 'x', finalHeight, 'px');
    }

    // Border calibration: shift content position to compensate for printer margins
    //
    // borderLeftPx = (expected - measured) in pixels
    //   - If user measures 7mm (expected 5mm): borderLeftPx = -2mm worth of pixels (negative)
    //     This means printer ADDS left margin, so we shift content LEFT
    //   - If user measures 3mm (expected 5mm): borderLeftPx = +2mm worth of pixels (positive)
    //     This means printer CLIPS left edge, so we shift content RIGHT (add left padding)
    //
    // To shift content LEFT: reduce left padding (but can't go negative, so we're limited)
    // To shift content RIGHT: increase left padding
    //
    // Since we start at 0 padding for a full-page image, we can only shift RIGHT by adding padding.
    // To shift LEFT, we'd need to crop, but that loses content. Instead, we accept the limitation
    // that we can only compensate for printers that CLIP (not ones that add margins).
    //
    // Actually, for printers that ADD margins: we put content at 0,0 and let the printer's
    // margin push it inward. No compensation needed in the file itself.
    // For printers that CLIP: we add padding to push content away from the clipped edge.

    // If compensation is positive (printer clips that edge), add padding to protect content
    // If compensation is negative (printer adds margin), use 0 padding - printer handles it
    const leftPad = Math.max(0, borderLeftPx);
    const topPad = Math.max(0, borderTopPx);
    const rightPad = Math.max(0, borderRightPx);
    const bottomPad = Math.max(0, borderBottomPx);

    console.log('[PrintWindows] Border compensation (px): left=', borderLeftPx, ', right=', borderRightPx,
                ', top=', borderTopPx, ', bottom=', borderBottomPx);
    console.log('[PrintWindows] Padding: left=', leftPad, ', top=', topPad, ', right=', rightPad, ', bottom=', bottomPad);

    // Process the image - resize to final dimensions, then add any necessary padding
    await sharp(inputPath)
        .resize(finalWidth, finalHeight, {
            fit: 'fill',
            withoutEnlargement: false
        })
        .extend({
            top: topPad,
            left: leftPad,
            right: rightPad,
            bottom: bottomPad,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toFile(outputPath);

    console.log('[PrintWindows] Processed PNG created successfully');
    return outputPath;
}

/**
 * Print a PNG file using PowerShell and Windows printing APIs
 * @param {string} filePath - Path to the PNG file to print
 * @param {object} options - Print options
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function printPng(filePath, options = {}) {
    console.log('[PrintWindows] Printing PNG file:', filePath);
    console.log('[PrintWindows] Print options:', options);
    console.log('[PrintWindows] showDialog value:', options.showDialog, 'type:', typeof options.showDialog);

    // Map paper source names to Windows paper source constants
    const paperSourceMap = {
        'default': 'AutomaticFeed',
        'rear': 'ManualFeed',
        'manual': 'ManualFeed',
        'tray1': 'Upper',
        'tray2': 'Lower',
        'upper': 'Upper',
        'lower': 'Lower',
        'middle': 'Middle',
        'envelope': 'Envelope',
        'manual_envelope': 'ManualEnvelope'
    };

    const paperSource = paperSourceMap[options.paperSource] || 'AutomaticFeed';
    const copies = options.copies || 1;
    const landscape = options.orientation === 'landscape';
    const printerName = options.printer || '';

    if (options.showDialog !== false) {
        // Show Windows print dialog
        return printWithDialog(filePath, printerName, landscape);
    }

    // Silent printing using PowerShell
    // The image is US Letter at 360 DPI (3960x3060 pixels = 11" x 8.5")
    // We want to print at 1:1 scale (actual size)
    const psScript = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

try {
    $filePath = "${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
    $printerName = "${printerName.replace(/"/g, '\\"')}"
    $copies = ${copies}
    $landscape = $${landscape}
    $paperSourceKind = "${paperSource}"

    # Get the printer name if not specified
    if ([string]::IsNullOrEmpty($printerName)) {
        $printerName = (Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Default=$true").Name
    }

    Write-Host "Printing to: $printerName"
    Write-Host "File: $filePath"

    # Load the image
    $image = [System.Drawing.Image]::FromFile($filePath)
    Write-Host "Image loaded: $($image.Width) x $($image.Height) pixels"
    Write-Host "Image DPI: $($image.HorizontalResolution) x $($image.VerticalResolution)"

    # Create PrintDocument with silent controller
    $printDoc = New-Object System.Drawing.Printing.PrintDocument
    $printDoc.PrinterSettings.PrinterName = $printerName
    $printDoc.PrinterSettings.Copies = $copies

    # Use StandardPrintController for truly silent printing (no progress dialog)
    $printDoc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

    # Set page settings for borderless/minimal margin printing
    $printDoc.DefaultPageSettings.Landscape = $landscape
    $printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

    # Find and set Letter paper size
    $paperSizes = $printDoc.PrinterSettings.PaperSizes
    Write-Host "Available paper sizes:"
    foreach ($size in $paperSizes) {
        Write-Host "  - $($size.PaperName) ($($size.Width/100)in x $($size.Height/100)in)"
        if ($size.Kind -eq [System.Drawing.Printing.PaperKind]::Letter) {
            $printDoc.DefaultPageSettings.PaperSize = $size
            Write-Host "  -> Selected Letter paper size"
        }
    }

    # Find the right paper source
    $paperSources = $printDoc.PrinterSettings.PaperSources
    Write-Host "Available paper sources:"
    $targetSource = $null
    foreach ($source in $paperSources) {
        Write-Host "  - $($source.SourceName) (Kind: $($source.Kind))"

        $kindMatch = switch ($paperSourceKind) {
            "ManualFeed" { $source.Kind -eq [System.Drawing.Printing.PaperSourceKind]::ManualFeed -or $source.SourceName -match "manual|rear|bypass" }
            "Upper" { $source.Kind -eq [System.Drawing.Printing.PaperSourceKind]::Upper -or $source.SourceName -match "tray.?1|upper" }
            "Lower" { $source.Kind -eq [System.Drawing.Printing.PaperSourceKind]::Lower -or $source.SourceName -match "tray.?2|lower" }
            "AutomaticFeed" { $source.Kind -eq [System.Drawing.Printing.PaperSourceKind]::AutomaticFeed -or $source.SourceName -match "auto" }
            default { $false }
        }

        if ($kindMatch -and $null -eq $targetSource) {
            $targetSource = $source
            Write-Host "  -> Selected this source"
        }
    }

    if ($null -ne $targetSource) {
        $printDoc.DefaultPageSettings.PaperSource = $targetSource
    }

    # Store image reference for PrintPage event
    $script:printImage = $image
    $script:imagePrinted = $false

    # Set up PrintPage event handler
    $printPageHandler = {
        param($sender, $e)

        if ($script:imagePrinted) {
            $e.HasMorePages = $false
            return
        }

        # Get page information
        $printArea = $e.PageBounds
        $margins = $e.MarginBounds
        $hardMarginX = $e.PageSettings.HardMarginX
        $hardMarginY = $e.PageSettings.HardMarginY

        Write-Host "Page bounds: $($printArea.Width) x $($printArea.Height)"
        Write-Host "Margin bounds: $($margins.Width) x $($margins.Height)"
        Write-Host "Hard margins: $hardMarginX x $hardMarginY"

        # Calculate image size in print units (1/100 inch)
        # The image is designed at 360 DPI, so we calculate its size in inches
        # and convert to print units (100 units per inch for .NET printing)
        $imageWidthInches = $script:printImage.Width / $script:printImage.HorizontalResolution
        $imageHeightInches = $script:printImage.Height / $script:printImage.VerticalResolution
        $imageWidthUnits = $imageWidthInches * 100
        $imageHeightUnits = $imageHeightInches * 100

        Write-Host "Image size in inches: $imageWidthInches x $imageHeightInches"
        Write-Host "Image size in print units: $imageWidthUnits x $imageHeightUnits"

        # Draw the image at actual size (1:1 scale)
        # The image is pre-processed with calibration adjustments baked in
        # Position at negative hard margins to compensate for printer's unprintable area
        # This places content at the true edge of the paper
        $drawX = -$hardMarginX
        $drawY = -$hardMarginY
        Write-Host "Drawing at position: $drawX, $drawY (compensating for hard margins)"
        $e.Graphics.DrawImage($script:printImage, $drawX, $drawY, $imageWidthUnits, $imageHeightUnits)

        $script:imagePrinted = $true
        $e.HasMorePages = $false
    }

    $printDoc.add_PrintPage($printPageHandler)

    # Print
    Write-Host "Starting print job..."
    $printDoc.Print()
    Write-Host "Print job submitted"

    # Cleanup
    $image.Dispose()
    $printDoc.Dispose()

    Write-Host "SUCCESS"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

    return runPowerShell(psScript);
}

/**
 * Print with Windows print dialog
 * @param {string} filePath - Path to the image file
 * @param {string} printerName - Optional printer name to pre-select
 * @param {boolean} landscape - Whether to print in landscape orientation
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function printWithDialog(filePath, printerName = '', landscape = true) {
    return new Promise((resolve) => {
        // Use Windows print dialog with 1:1 scale printing
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $filePath = "${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"

    # Open print dialog with the image
    $printDialog = New-Object System.Windows.Forms.PrintDialog
    $printDoc = New-Object System.Drawing.Printing.PrintDocument

    ${printerName ? `$printDoc.PrinterSettings.PrinterName = "${printerName.replace(/"/g, '\\"')}"` : ''}

    # Set page settings for borderless/minimal margin printing
    $printDoc.DefaultPageSettings.Landscape = $${landscape}
    $printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

    $printDialog.Document = $printDoc
    $printDialog.AllowSomePages = $false
    $printDialog.ShowHelp = $false
    $printDialog.UseEXDialog = $true

    # Load the image
    $image = [System.Drawing.Image]::FromFile($filePath)
    $script:printImage = $image
    $script:imagePrinted = $false

    Write-Host "Image loaded: $($image.Width) x $($image.Height) pixels"
    Write-Host "Image DPI: $($image.HorizontalResolution) x $($image.VerticalResolution)"

    # Set up PrintPage event
    $printPageHandler = {
        param($sender, $e)

        if ($script:imagePrinted) {
            $e.HasMorePages = $false
            return
        }

        # Get hard margins to compensate for printer's unprintable area
        $hardMarginX = $e.PageSettings.HardMarginX
        $hardMarginY = $e.PageSettings.HardMarginY

        # Calculate image size in print units (1/100 inch) for 1:1 scale printing
        $imageWidthInches = $script:printImage.Width / $script:printImage.HorizontalResolution
        $imageHeightInches = $script:printImage.Height / $script:printImage.VerticalResolution
        $imageWidthUnits = $imageWidthInches * 100
        $imageHeightUnits = $imageHeightInches * 100

        Write-Host "Image size in inches: $imageWidthInches x $imageHeightInches"
        Write-Host "Hard margins: $hardMarginX x $hardMarginY"
        Write-Host "Drawing at 1:1 scale (actual size)"

        # Draw the image at actual size (1:1 scale)
        # Position at negative hard margins to compensate for printer's unprintable area
        $drawX = -$hardMarginX
        $drawY = -$hardMarginY
        Write-Host "Drawing at position: $drawX, $drawY (compensating for hard margins)"
        $e.Graphics.DrawImage($script:printImage, $drawX, $drawY, $imageWidthUnits, $imageHeightUnits)

        $script:imagePrinted = $true
        $e.HasMorePages = $false
    }

    $printDoc.add_PrintPage($printPageHandler)

    $result = $printDialog.ShowDialog()

    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        $printDoc.Print()
        Write-Host "SUCCESS"
    } else {
        Write-Host "CANCELLED"
    }

    $image.Dispose()
    $printDoc.Dispose()
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

        runPowerShell(psScript).then(resolve);
    });
}

/**
 * Execute a PowerShell script and return the result
 * @param {string} script - PowerShell script to execute
 * @returns {Promise<{success: boolean, error?: string, output?: string}>}
 */
function runPowerShell(script) {
    return new Promise((resolve) => {
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log('[PrintWindows PS]', data.toString().trim());
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error('[PrintWindows PS Error]', data.toString().trim());
        });

        child.on('close', (code) => {
            if (code === 0 && (stdout.includes('SUCCESS') || stdout.includes('CANCELLED'))) {
                const cancelled = stdout.includes('CANCELLED');
                console.log('[PrintWindows] PowerShell completed:', cancelled ? 'cancelled' : 'success');
                resolve({ success: !cancelled, cancelled, output: stdout });
            } else if (code === 0) {
                console.log('[PrintWindows] PowerShell completed with output:', stdout);
                resolve({ success: true, output: stdout });
            } else {
                console.error('[PrintWindows] PowerShell exited with code:', code);
                resolve({ success: false, error: stderr || stdout || `Exit code ${code}` });
            }
        });

        child.on('error', (err) => {
            console.error('[PrintWindows] Error running PowerShell:', err.message);
            resolve({ success: false, error: err.message });
        });

        // Timeout after 120 seconds (print dialogs can take a while)
        setTimeout(() => {
            child.kill();
            resolve({ success: false, error: 'Print timeout' });
        }, 120000);
    });
}

/**
 * Print an image with calibration applied
 * @param {string} imagePath - Path to the image file
 * @param {object} options - Options
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function printImage(imagePath, options = {}) {
    const cleanup = options.cleanup !== false;

    try {
        // Generate processed PNG path in temp directory
        const tmpDir = os.tmpdir();
        const imageName = path.basename(imagePath, path.extname(imagePath));
        const processedPath = path.join(tmpDir, `${imageName}-calibrated-${Date.now()}.png`);

        // Apply calibration to create processed PNG
        // Pass through page dimensions from template config if provided
        await applyCalibrationToPng(imagePath, processedPath, {
            calibration: options.calibration,
            borderCalibration: options.borderCalibration,
            pageWidthInches: options.pageWidthInches,
            pageHeightInches: options.pageHeightInches
        });

        // Print the processed PNG
        const printResult = await printPng(processedPath, {
            printer: options.printer,
            showDialog: options.showDialog,
            orientation: options.orientation || 'landscape',
            paperSize: options.paperSize || 'letter',
            copies: options.copies || 1,
            paperSource: options.paperSource || 'default'
        });

        // Clean up the temporary processed PNG
        if (cleanup && printResult.success) {
            try {
                fs.unlinkSync(processedPath);
                console.log('[PrintWindows] Cleaned up temporary PNG:', processedPath);
            } catch (cleanupErr) {
                console.error('[PrintWindows] Error cleaning up PNG:', cleanupErr);
            }
        }

        return printResult;
    } catch (err) {
        console.error('[PrintWindows] Error in printImage:', err);
        return {
            success: false,
            error: err.message
        };
    }
}

// Border calibration constants
const BORDER_INSET_MM = 5;  // Border is 5mm from edge of document
const BORDER_THICKNESS_MM = 5;  // Border is 5mm thick

/**
 * Generate a calibration test page PNG with 4 dots arranged in a square
 * and a 5mm thick black border 5mm inset from the edge for border calibration
 * @param {string} outputPath - Path to save the calibration PNG
 * @returns {Promise<string>} Path to the created PNG
 */
async function generateCalibrationTestPage(outputPath) {
    console.log('[PrintWindows] Generating calibration test page PNG');
    console.log('[PrintWindows] Output:', outputPath);

    // 100mm in pixels at print DPI
    const distancePixels = mmToPixels(CALIBRATION_EXPECTED_DISTANCE_MM);

    // Center of the page
    const centerX = PAGE_WIDTH_PX / 2;
    const centerY = PAGE_HEIGHT_PX / 2;

    // Calculate dot positions (square centered on page)
    const halfDist = distancePixels / 2;
    const dots = {
        A: { x: centerX - halfDist, y: centerY - halfDist },
        B: { x: centerX + halfDist, y: centerY - halfDist },
        C: { x: centerX + halfDist, y: centerY + halfDist },
        D: { x: centerX - halfDist, y: centerY + halfDist }
    };

    const dotRadius = Math.round(PRINT_DPI * 0.07); // ~7mm dots

    // Border calibration: 5mm thick border, 5mm inset from edge
    const borderInsetPx = mmToPixels(BORDER_INSET_MM);
    const borderThicknessPx = mmToPixels(BORDER_THICKNESS_MM);

    // SVG strokes are centered on the path, so we need to position the rect's center line
    // For the OUTER edge of the border to be at 5mm from document edge:
    // - The rect path (center of stroke) should be at: inset + thickness/2
    // The user measures from paper edge to the outer edge of the black border
    const borderCenterX = borderInsetPx + (borderThicknessPx / 2);
    const borderCenterY = borderInsetPx + (borderThicknessPx / 2);
    const borderRectWidth = PAGE_WIDTH_PX - (2 * borderCenterX);
    const borderRectHeight = PAGE_HEIGHT_PX - (2 * borderCenterY);

    // Create SVG for the calibration page
    // Use viewBox for coordinate system, set width/height in pixels to avoid Sharp scaling issues
    const svg = `
<svg width="${PAGE_WIDTH_PX}" height="${PAGE_HEIGHT_PX}" viewBox="0 0 ${PAGE_WIDTH_PX} ${PAGE_HEIGHT_PX}" xmlns="http://www.w3.org/2000/svg">
    <!-- White background -->
    <rect width="100%" height="100%" fill="white"/>

    <!-- 5mm thick black border, 5mm inset from document edge -->
    <!-- User measures the white space between paper edge and outer edge of black border (should be 5mm if perfect) -->
    <rect x="${borderCenterX}" y="${borderCenterY}" width="${borderRectWidth}" height="${borderRectHeight}"
          fill="none" stroke="black" stroke-width="${borderThicknessPx}"/>

    <!-- Connecting lines between dots -->
    <line x1="${dots.A.x}" y1="${dots.A.y}" x2="${dots.B.x}" y2="${dots.B.y}" stroke="#888888" stroke-width="2"/>
    <line x1="${dots.B.x}" y1="${dots.B.y}" x2="${dots.C.x}" y2="${dots.C.y}" stroke="#888888" stroke-width="2"/>
    <line x1="${dots.C.x}" y1="${dots.C.y}" x2="${dots.D.x}" y2="${dots.D.y}" stroke="#888888" stroke-width="2"/>
    <line x1="${dots.D.x}" y1="${dots.D.y}" x2="${dots.A.x}" y2="${dots.A.y}" stroke="#888888" stroke-width="2"/>

    <!-- Dots -->
    <circle cx="${dots.A.x}" cy="${dots.A.y}" r="${dotRadius}" fill="black"/>
    <circle cx="${dots.B.x}" cy="${dots.B.y}" r="${dotRadius}" fill="black"/>
    <circle cx="${dots.C.x}" cy="${dots.C.y}" r="${dotRadius}" fill="black"/>
    <circle cx="${dots.D.x}" cy="${dots.D.y}" r="${dotRadius}" fill="black"/>

    <!-- Labels -->
    <text x="${dots.A.x}" y="${dots.A.y - dotRadius - 20}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.15)}" font-family="Arial" fill="black">A</text>
    <text x="${dots.B.x}" y="${dots.B.y - dotRadius - 20}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.15)}" font-family="Arial" fill="black">B</text>
    <text x="${dots.C.x}" y="${dots.C.y + dotRadius + 60}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.15)}" font-family="Arial" fill="black">C</text>
    <text x="${dots.D.x}" y="${dots.D.y + dotRadius + 60}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.15)}" font-family="Arial" fill="black">D</text>

    <!-- Title -->
    <text x="${centerX}" y="${Math.round(PRINT_DPI * 0.5)}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.18)}" font-family="Arial" font-weight="bold" fill="black">PRINT CALIBRATION TEST PAGE</text>

    <!-- Instructions -->
    <text x="${centerX}" y="${Math.round(PRINT_DPI * 0.75)}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.1)}" font-family="Arial" fill="#555555">Expected distance between adjacent dots: ${CALIBRATION_EXPECTED_DISTANCE_MM}mm</text>
    <text x="${centerX}" y="${PAGE_HEIGHT_PX - Math.round(PRINT_DPI * 0.6)}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.1)}" font-family="Arial" fill="#555555">Measure A-B, B-C, C-D, D-A distances and border gaps (in mm)</text>
    <text x="${centerX}" y="${PAGE_HEIGHT_PX - Math.round(PRINT_DPI * 0.4)}" text-anchor="middle" font-size="${Math.round(PRINT_DPI * 0.09)}" font-family="Arial" fill="#555555">Border: Measure white space from paper edge to black border. Expected: ${BORDER_INSET_MM}mm</text>
</svg>`;

    // Convert SVG to PNG using sharp
    // Don't pass density to input - it causes Sharp to scale up internally and exceed pixel limits
    // The SVG already specifies exact pixel dimensions in viewBox and width/height
    // We just set the DPI metadata on output so the PNG prints at correct physical size
    await sharp(Buffer.from(svg))
        .withMetadata({ density: PRINT_DPI })
        .png()
        .toFile(outputPath);

    console.log('[PrintWindows] Calibration test page PNG created successfully');
    console.log('[PrintWindows] Output dimensions:', PAGE_WIDTH_PX, 'x', PAGE_HEIGHT_PX, 'at', PRINT_DPI, 'DPI');
    return outputPath;
}

/**
 * Print the calibration test page
 * @param {object} options - Print options
 * @returns {Promise<{success: boolean, error?: string, path?: string}>}
 */
async function printCalibrationPage(options = {}) {
    try {
        const tmpDir = os.tmpdir();
        const outputPath = path.join(tmpDir, `calibration-test-${Date.now()}.png`);

        await generateCalibrationTestPage(outputPath);

        // Print without any calibration (this is the test page to measure calibration)
        const result = await printPng(outputPath, {
            printer: options.printer,
            showDialog: options.showDialog !== undefined ? options.showDialog : true,
            orientation: 'landscape',
            paperSize: options.paperSize || 'letter',
            copies: 1,
            paperSource: options.paperSource || 'default'
        });

        return { ...result, path: outputPath };
    } catch (err) {
        console.error('[PrintWindows] Error printing calibration page:', err);
        return { success: false, error: err.message };
    }
}

module.exports = {
    printImage,
    printPng,
    printCalibrationPage,
    generateCalibrationTestPage,
    applyCalibrationToPng,
    calculateCalibration,
    getCalibrationFromProfile,
    CALIBRATION_EXPECTED_DISTANCE_MM,
    BORDER_INSET_MM,
    BORDER_THICKNESS_MM,
    PAGE_WIDTH_PX,
    PAGE_HEIGHT_PX,
    PRINT_DPI
};
