// Foster Card Generator - Preact + HTM Application
// Recreated from vanilla JS with modern component architecture

const { h, render, createContext } = preact;
const { useState, useEffect, useCallback, useContext, useRef, useMemo } = preactHooks;
const html = htm.bind(h);

// ============================================================
// Node.js / Electron imports
// ============================================================
const fs = require('fs');
const path = require('path');
const db = require('../db.js');
const { ipcRenderer } = require('electron');
const Handlebars = require('handlebars');
const QRCode = require('qrcode');

// Card generation functions
let generateCardFront = null;
let generateCardBack = null;
let generateFromTemplate = null;
try {
    const cardGen = require('../generate-card-cli.js');
    generateCardFront = cardGen.generateCardFront;
    generateCardBack = cardGen.generateCardBack;
    generateFromTemplate = cardGen.generateFromTemplate;
} catch (err) {
    console.error('[App] Failed to load card generation module:', err.message);
}

// ============================================================
// Constants and Paths
// ============================================================
const APP_PATH = path.join(__dirname, '..', '..');
let DB_DIR = null;
let DB_PATH = null;
let LOG_DIR = null;
let LOG_FILE = null;

// ============================================================
// Logging
// ============================================================
const logMessages = [];
let loggingReady = false;

function log(...args) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    const timestamp = new Date().toISOString();
    logMessages.push(`[${timestamp}] ${message}`);
    if (loggingReady && LOG_FILE) {
        try {
            let content = '';
            try { content = fs.readFileSync(LOG_FILE, 'utf8'); } catch (e) {}
            fs.writeFileSync(LOG_FILE, content + `[${timestamp}] ${message}\n`);
        } catch (err) {
            console.error('Log write failed:', err);
        }
    }
    console.log(...args);
}

// ============================================================
// Utility Functions
// ============================================================
function formatCompatibility(value) {
    if (value === '1' || value === 1 || value === true) {
        return { text: 'Yes', class: 'compat-yes' };
    }
    if (value === '0' || value === 0 || value === false) {
        return { text: 'No', class: 'compat-no' };
    }
    return { text: '?', class: 'compat-unknown' };
}

function getPaperSizeLabel(size) {
    const labels = {
        'letter': 'Letter (8.5 x 11 in)',
        'legal': 'Legal (8.5 x 14 in)',
        'A4': 'A4 (210 x 297 mm)',
        'A5': 'A5 (148 x 210 mm)'
    };
    return labels[size] || size;
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function fileToImageData(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let hexString = '';
    for (let i = 0; i < uint8Array.length; i++) {
        hexString += uint8Array[i].toString(16).padStart(2, '0');
    }
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    return {
        hex: hexString,
        mime: file.type || 'image/jpeg',
        path: file.name,
        dataUrl: `data:${file.type};base64,${base64}`
    };
}

function bufferToImageData(buffer, filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const mimeTypes = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'gif': 'image/gif', 'webp': 'image/webp'
    };
    const mime = mimeTypes[ext] || 'image/jpeg';
    let hexString = '';
    for (let i = 0; i < buffer.length; i++) {
        hexString += buffer[i].toString(16).padStart(2, '0');
    }
    const base64 = buffer.toString('base64');
    return {
        hex: hexString,
        mime: mime,
        path: path.basename(filePath),
        dataUrl: `data:${mime};base64,${base64}`
    };
}

function getRescueLogoDataUrl(rescue) {
    if (!rescue) return null;
    if (rescue.logo_data) {
        const mimeType = rescue.logo_mime || (rescue.logo_path?.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const base64 = Buffer.from(rescue.logo_data).toString('base64');
        return `data:${mimeType};base64,${base64}`;
    }
    return null;
}

// ============================================================
// CodeMirror Editor Component (using CodeMirror 5)
// ============================================================
function CodeMirrorEditor({ value, onChange, language, disabled }) {
    const containerRef = useRef(null);
    const editorRef = useRef(null);
    const onChangeRef = useRef(onChange);
    const isUpdatingRef = useRef(false);

    // Keep onChange ref up to date
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    // Initialize editor
    useEffect(() => {
        if (!containerRef.current || !window.CodeMirror) return;

        // Destroy existing editor if any
        if (editorRef.current) {
            editorRef.current.toTextArea();
            editorRef.current = null;
        }

        // Create a textarea for CodeMirror to enhance
        const textarea = document.createElement('textarea');
        textarea.value = value || '';
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(textarea);

        // Determine mode based on language
        let mode = 'htmlmixed';
        if (language === 'json') {
            mode = { name: 'javascript', json: true };
        }

        const editor = CodeMirror.fromTextArea(textarea, {
            mode: mode,
            theme: 'default',
            lineNumbers: true,
            lineWrapping: true,
            readOnly: disabled,
            autoCloseBrackets: true,
            autoCloseTags: language === 'html',
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            extraKeys: {
                'Ctrl-Space': function(cm) {
                    if (language === 'html') {
                        CodeMirror.showHint(cm, CodeMirror.hint.handlebars, { completeSingle: false });
                    }
                },
                'Tab': function(cm) {
                    if (cm.somethingSelected()) {
                        cm.indentSelection('add');
                    } else {
                        cm.replaceSelection('    ', 'end');
                    }
                }
            }
        });

        // Handle changes
        editor.on('change', () => {
            if (!isUpdatingRef.current && onChangeRef.current) {
                onChangeRef.current(editor.getValue());
            }
        });

        // Show Handlebars hints when typing {{
        if (language === 'html') {
            editor.on('inputRead', (cm, change) => {
                if (change.text[0] === '{' && change.origin === '+input') {
                    const cur = cm.getCursor();
                    const line = cm.getLine(cur.line);
                    if (cur.ch >= 2 && line.slice(cur.ch - 2, cur.ch) === '{{') {
                        CodeMirror.showHint(cm, CodeMirror.hint.handlebars, { completeSingle: false });
                    }
                }
            });
        }

        editorRef.current = editor;

        // Refresh after a short delay to ensure proper sizing
        setTimeout(() => {
            if (editorRef.current) {
                editorRef.current.refresh();
            }
        }, 100);

        return () => {
            if (editorRef.current) {
                editorRef.current.toTextArea();
                editorRef.current = null;
            }
        };
    }, [language, disabled]);

    // Update editor content when value prop changes externally
    useEffect(() => {
        if (!editorRef.current) return;
        const currentValue = editorRef.current.getValue();
        if (value !== currentValue) {
            isUpdatingRef.current = true;
            const cursor = editorRef.current.getCursor();
            editorRef.current.setValue(value || '');
            editorRef.current.setCursor(cursor);
            isUpdatingRef.current = false;
        }
    }, [value]);

    return html`
        <div
            ref=${containerRef}
            class="codemirror-container"
        />
    `;
}

// ============================================================
// Context Providers
// ============================================================
const AppContext = createContext(null);
const ToastContext = createContext(null);
const ModalContext = createContext(null);

// ============================================================
// Toast Component
// ============================================================
function Toast({ message, type, onDismiss }) {
    useEffect(() => {
        const timer = setTimeout(onDismiss, 3000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return html`
        <div class="toast toast-${type}">
            ${message}
        </div>
    `;
}

function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback((message, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const dismissToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return html`
        <${ToastContext.Provider} value=${showToast}>
            ${children}
            <div class="toast-container">
                ${toasts.map(t => html`
                    <${Toast}
                        key=${t.id}
                        message=${t.message}
                        type=${t.type}
                        onDismiss=${() => dismissToast(t.id)}
                    />
                `)}
            </div>
        <//>
    `;
}

function useToast() {
    return useContext(ToastContext);
}

// ============================================================
// Modal Component
// ============================================================
function Modal({ isOpen, onClose, title, children, footer, width = '600px' }) {
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleOverlayClick = (e) => {
        if (e.target.classList.contains('modal-overlay')) onClose();
    };

    return html`
        <div class="modal-overlay active" onClick=${handleOverlayClick}>
            <div class="modal" style="max-width: ${width}">
                ${title && html`
                    <div class="modal-header">
                        <h2>${title}</h2>
                        <button class="modal-close" onClick=${onClose}>×</button>
                    </div>
                `}
                <div class="modal-body">
                    ${children}
                </div>
                ${footer && html`
                    <div class="modal-footer">
                        ${footer}
                    </div>
                `}
            </div>
        </div>
    `;
}

// ============================================================
// Image Upload Component
// ============================================================
function ImageUpload({ imageUrl, onImageChange, placeholder = '🐕', onAIEdit, onSelectFromWebsite, hasWebsitePhotos }) {
    const inputRef = useRef(null);

    const handleUploadClick = (e) => {
        e.stopPropagation();
        inputRef.current?.click();
    };

    const handleAIEditClick = (e) => {
        e.stopPropagation();
        if (onAIEdit && imageUrl) {
            onAIEdit();
        }
    };

    const handleSelectFromWebsiteClick = (e) => {
        e.stopPropagation();
        if (onSelectFromWebsite) {
            onSelectFromWebsite();
        }
    };

    const handleChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const imageData = await fileToImageData(file);
            onImageChange(imageData);
        } catch (err) {
            console.error('Error loading image:', err);
        }
    };

    return html`
        <input
            type="file"
            ref=${inputRef}
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            style="display: none;"
            onChange=${handleChange}
        />
        <div class="modal-image-container">
            ${imageUrl
                ? html`<img class="modal-image" src=${imageUrl} alt="Preview" />`
                : html`<div class="modal-no-image">${placeholder}</div>`
            }
            <div class="image-overlay">
                <div class="image-overlay-buttons">
                    <button class="image-overlay-btn" onClick=${handleUploadClick}>
                        <span>📷</span>
                        ${imageUrl ? 'Change Photo' : 'Add Photo'}
                    </button>
                    ${imageUrl && onAIEdit && html`
                        <button class="image-overlay-btn" onClick=${handleAIEditClick}>
                            <span>🪄</span>
                            Edit with AI
                        </button>
                    `}
                    ${hasWebsitePhotos && onSelectFromWebsite && html`
                        <button class="image-overlay-btn" onClick=${handleSelectFromWebsiteClick}>
                            <span>🌐</span>
                            Select from Website
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// AI Edit Image Modal
// ============================================================
function AIEditImageModal({ isOpen, onClose, imageUrl, onSave }) {
    const [prompt, setPrompt] = useState('');
    const [generating, setGenerating] = useState(false);
    const [editedImageUrl, setEditedImageUrl] = useState(null);
    const showToast = useToast();

    useEffect(() => {
        if (!isOpen) {
            setPrompt('');
            setEditedImageUrl(null);
            setGenerating(false);
        }
    }, [isOpen]);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            showToast('Please enter a description of how you want to change the picture.', 'error');
            return;
        }

        const apiKey = db.getSetting('openai_api_key');
        if (!apiKey) {
            showToast('Please set your OpenAI API key in Settings first.', 'error');
            return;
        }

        const currentImage = editedImageUrl || imageUrl;
        if (!currentImage) {
            showToast('No image to edit.', 'error');
            return;
        }

        setGenerating(true);
        try {
            // Use gpt-image-1 (GPT-4o native image editing) which can edit images directly
            const response = await fetch('https://api.openai.com/v1/images/edits', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: await createImageEditFormData(currentImage, prompt)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
            }

            const data = await response.json();
            if (data.data && data.data[0]) {
                let newImageUrl;
                if (data.data[0].b64_json) {
                    newImageUrl = `data:image/png;base64,${data.data[0].b64_json}`;
                } else if (data.data[0].url) {
                    // Fetch the URL and convert to data URL
                    const imgResponse = await fetch(data.data[0].url);
                    const blob = await imgResponse.blob();
                    const reader = new FileReader();
                    newImageUrl = await new Promise((resolve) => {
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                } else {
                    throw new Error('No image data in response');
                }
                setEditedImageUrl(newImageUrl);
                showToast('Image generated! You can continue editing or save.');
            } else {
                throw new Error('No image returned from API');
            }
        } catch (err) {
            showToast(`Error generating image: ${err.message}`, 'error');
        } finally {
            setGenerating(false);
            setPrompt('');
        }
    };

    const handleSave = () => {
        if (editedImageUrl) {
            onSave(editedImageUrl);
        }
        onClose();
    };

    const displayImage = editedImageUrl || imageUrl;

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSave} disabled=${!editedImageUrl}>
            Save Changes
        </button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Edit Image with AI" footer=${footer}>
            <div class="ai-edit-image-container">
                ${displayImage
                    ? html`<img class="ai-edit-preview" src=${displayImage} alt="Preview" />`
                    : html`<div class="modal-no-image">No image</div>`
                }
            </div>
            <div class="form-group" style="margin-top: 15px;">
                <label for="ai-prompt">Describe how you want to change the picture:</label>
                <textarea
                    id="ai-prompt"
                    value=${prompt}
                    onInput=${(e) => setPrompt(e.target.value)}
                    placeholder="e.g., Make the background a sunny park, remove the leash, make it look more professional..."
                    rows="3"
                    style="width: 100%; resize: vertical;"
                    disabled=${generating}
                />
            </div>
            <button
                class="btn btn-primary"
                onClick=${handleGenerate}
                disabled=${generating || !prompt.trim()}
                style="width: 100%; margin-top: 10px;"
            >
                ${generating ? 'Generating...' : 'Generate'}
            </button>
            ${editedImageUrl && html`
                <p style="margin-top: 10px; color: #666; font-size: 0.9rem; text-align: center;">
                    You can enter another prompt to continue editing, or save your changes.
                </p>
            `}
        <//>
    `;
}

// Helper function to create form data for OpenAI gpt-image-1 edit API
async function createImageEditFormData(imageDataUrl, prompt) {
    const formData = new FormData();

    // Convert data URL to blob
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();

    // Convert to PNG format (required by the API)
    const pngBlob = await convertToPng(blob);

    formData.append('model', 'gpt-image-1');
    formData.append('image', pngBlob, 'image.png');
    formData.append('prompt', prompt);

    return formData;
}

// Convert image blob to PNG format using canvas
async function convertToPng(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((pngBlob) => {
                if (pngBlob) {
                    resolve(pngBlob);
                } else {
                    reject(new Error('Failed to convert image to PNG'));
                }
            }, 'image/png');
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(blob);
    });
}

// ============================================================
// Photo Picker Modal
// ============================================================
function PhotoPickerModal({ isOpen, onClose, photoUrls, onSelect }) {
    const [loading, setLoading] = useState({});
    const [selected, setSelected] = useState(null);
    const showToast = useToast();

    useEffect(() => {
        if (!isOpen) {
            setSelected(null);
            setLoading({});
        }
    }, [isOpen]);

    const handleSelect = async () => {
        if (!selected) return;

        setLoading(prev => ({ ...prev, [selected]: true }));
        try {
            // Fetch the image and convert to data URL
            const response = await fetch(selected);
            if (!response.ok) throw new Error('Failed to fetch image');

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Convert to hex string
            let hex = '';
            for (let i = 0; i < uint8Array.length; i++) {
                hex += uint8Array[i].toString(16).padStart(2, '0');
            }

            // Convert to base64 for data URL
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const mime = blob.type || 'image/jpeg';

            onSelect({
                hex,
                mime,
                path: selected,
                dataUrl: `data:${mime};base64,${base64}`
            });
            onClose();
        } catch (err) {
            showToast(`Error loading image: ${err.message}`, 'error');
        } finally {
            setLoading(prev => ({ ...prev, [selected]: false }));
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSelect} disabled=${!selected || loading[selected]}>
            ${loading[selected] ? 'Loading...' : 'Use Selected Photo'}
        </button>
    `;

    if (!photoUrls || photoUrls.length === 0) {
        return html`
            <${Modal} isOpen=${isOpen} onClose=${onClose} title="Select Photo from Website" footer=${footer}>
                <p style="text-align: center; color: #666; padding: 20px;">
                    No additional photos available from the adoption website.
                </p>
            <//>
        `;
    }

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Select Photo from Website" footer=${footer} width="700px">
            <p style="margin-bottom: 15px; color: #666;">
                Click on a photo to select it, then click "Use Selected Photo" to apply it.
            </p>
            <div class="photo-picker-grid">
                ${photoUrls.map(url => html`
                    <div
                        key=${url}
                        class="photo-picker-item ${selected === url ? 'selected' : ''}"
                        onClick=${() => setSelected(url)}
                    >
                        <img src=${url} alt="Pet photo option" loading="lazy" />
                        ${selected === url && html`
                            <div class="photo-picker-checkmark">✓</div>
                        `}
                    </div>
                `)}
            </div>
        <//>
    `;
}

// ============================================================
// Form Components
// ============================================================
function FormGroup({ label, children, id }) {
    return html`
        <div class="form-group">
            <label for=${id}>${label}</label>
            ${children}
        </div>
    `;
}

function FormRow({ cols = 2, children }) {
    const className = cols === 3 ? 'form-row-3' : 'form-row';
    return html`<div class=${className}>${children}</div>`;
}

// ============================================================
// Animal Card Component
// ============================================================
function AnimalCard({ animal, rescue, onEdit, onPrintFront, onPrintBack, onPrintFlyer, customTemplates, onPrintWithTemplate }) {
    const kids = formatCompatibility(animal.kids);
    const dogs = formatCompatibility(animal.dogs);
    const cats = formatCompatibility(animal.cats);
    const logoDataUrl = getRescueLogoDataUrl(rescue);

    return html`
        <div class="animal-card" data-id=${animal.id}>
            <div class="animal-image-container" onClick=${() => onEdit(animal.id)}>
                ${animal.imageDataUrl
                    ? html`<img class="animal-image" src=${animal.imageDataUrl} alt=${animal.name} />`
                    : html`<div class="no-image">🐕</div>`
                }
                ${logoDataUrl && html`
                    <img class="rescue-logo-badge" src=${logoDataUrl} alt=${rescue.name} title=${rescue.name} />
                `}
            </div>
            <div class="animal-info">
                <div onClick=${() => onEdit(animal.id)} style="cursor: pointer;">
                    <h2 class="animal-name">${animal.name}</h2>
                    <p class="animal-breed">${animal.breed}</p>
                    <div class="animal-details">
                        <div class="detail">
                            <span class="detail-label">Age:</span>
                            <span class="detail-value">${animal.age_long}</span>
                        </div>
                        <div class="detail">
                            <span class="detail-label">Size:</span>
                            <span class="detail-value">${animal.size}</span>
                        </div>
                        <div class="detail">
                            <span class="detail-label">Gender:</span>
                            <span class="detail-value">${animal.gender}</span>
                        </div>
                        <div class="detail">
                            <span class="detail-label">Shots:</span>
                            <span class="detail-value">${animal.shots ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                    <div class="compatibility">
                        <span class="compat-badge ${kids.class}">Kids: ${kids.text}</span>
                        <span class="compat-badge ${dogs.class}">Dogs: ${dogs.text}</span>
                        <span class="compat-badge ${cats.class}">Cats: ${cats.text}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <div class="card-actions-section">
                        <span class="card-actions-label">Cards</span>
                        <div class="card-actions-buttons">
                            <button class="btn-print-front" onClick=${(e) => { e.stopPropagation(); onPrintFront(animal.id); }}>
                                Print Front
                            </button>
                            <button class="btn-print-back" onClick=${(e) => { e.stopPropagation(); onPrintBack(animal.id); }}>
                                Print Back
                            </button>
                        </div>
                    </div>
                    <button class="btn-print-flyer" onClick=${(e) => { e.stopPropagation(); onPrintFlyer(animal.id); }}>
                        Print Flyer
                    </button>
                    ${customTemplates && customTemplates.length > 0 && html`
                        <div class="card-actions-section">
                            <span class="card-actions-label">Custom Templates</span>
                            <div class="card-actions-buttons custom-template-buttons">
                                ${customTemplates.map(template => html`
                                    <button
                                        key=${template.id}
                                        class="btn-print-template"
                                        onClick=${(e) => { e.stopPropagation(); onPrintWithTemplate(animal.id, template.id); }}
                                        title=${template.description || template.name}
                                    >
                                        ${template.name}
                                    </button>
                                `)}
                            </div>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Animal Form Component (shared between Create and Edit)
// ============================================================
function AnimalForm({ animal, rescues, imageData, onImageChange, formRef, onAIEdit, onSelectFromWebsite, photoUrls, includeBio = true }) {
    const imageUrl = imageData?.dataUrl || animal?.imageDataUrl || null;
    const hasWebsitePhotos = photoUrls && photoUrls.length > 0;

    return html`
        <${ImageUpload}
            imageUrl=${imageUrl}
            onImageChange=${onImageChange}
            placeholder="🐕"
            onAIEdit=${onAIEdit}
            onSelectFromWebsite=${onSelectFromWebsite}
            hasWebsitePhotos=${hasWebsitePhotos}
        />
        <form ref=${formRef}>
            <${FormRow}>
                <${FormGroup} label="Name" id="name">
                    <input type="text" id="name" name="name" defaultValue=${animal?.name || ''} required />
                <//>
                <${FormGroup} label="Breed" id="breed">
                    <input type="text" id="breed" name="breed" defaultValue=${animal?.breed || ''} required />
                <//>
            <//>

            <${FormGroup} label="Adoption URL" id="slug">
                <input type="text" id="slug" name="slug" defaultValue=${animal?.slug || ''} required />
            <//>

            <${FormRow}>
                <${FormGroup} label="Age (Long)" id="ageLong">
                    <input type="text" id="ageLong" name="age_long" placeholder="e.g., 2 Years" defaultValue=${animal?.age_long || ''} required />
                <//>
                <${FormGroup} label="Age (Short)" id="ageShort">
                    <input type="text" id="ageShort" name="age_short" placeholder="e.g., 2 Yr" defaultValue=${animal?.age_short || ''} required />
                <//>
            <//>

            <${FormRow} cols=${3}>
                <${FormGroup} label="Size" id="size">
                    <select id="size" name="size" required>
                        <option value="Small" selected=${(animal?.size || 'Medium') === 'Small'}>Small</option>
                        <option value="Medium" selected=${(animal?.size || 'Medium') === 'Medium'}>Medium</option>
                        <option value="Large" selected=${(animal?.size || 'Medium') === 'Large'}>Large</option>
                    </select>
                <//>
                <${FormGroup} label="Gender" id="gender">
                    <select id="gender" name="gender" required>
                        <option value="Male" selected=${(animal?.gender || 'Male') === 'Male'}>Male</option>
                        <option value="Female" selected=${(animal?.gender || 'Male') === 'Female'}>Female</option>
                        <option value="Neutered(M)" selected=${(animal?.gender || 'Male') === 'Neutered(M)'}>Neutered(M)</option>
                        <option value="Spayed(F)" selected=${(animal?.gender || 'Male') === 'Spayed(F)'}>Spayed(F)</option>
                    </select>
                <//>
                <${FormGroup} label="Shots" id="shots">
                    <select id="shots" name="shots" required>
                        <option value="1" selected=${animal ? !!animal.shots : true}>Yes</option>
                        <option value="0" selected=${animal ? !animal.shots : false}>No</option>
                    </select>
                <//>
            <//>

            <${FormRow}>
                <${FormGroup} label="Housetrained" id="housetrained">
                    <select id="housetrained" name="housetrained" required>
                        <option value="1" selected=${animal ? !!animal.housetrained : true}>Yes</option>
                        <option value="0" selected=${animal ? !animal.housetrained : false}>No</option>
                    </select>
                <//>
                <${FormGroup} label="Rescue Organization" id="rescue">
                    <select id="rescue" name="rescue_id" required>
                        ${rescues.map(r => html`<option key=${r.id} value=${r.id} selected=${(animal?.rescue_id || rescues[0]?.id) === r.id}>${r.name}</option>`)}
                    </select>
                <//>
            <//>

            <${FormRow} cols=${3}>
                <${FormGroup} label="Good with Kids" id="kids">
                    <select id="kids" name="kids" required>
                        <option value="1" selected=${animal?.kids === 1 || animal?.kids === '1'}>Yes</option>
                        <option value="0" selected=${animal?.kids === 0 || animal?.kids === '0'}>No</option>
                        <option value="?" selected=${animal?.kids == null || animal?.kids === '?'}>Unknown</option>
                    </select>
                <//>
                <${FormGroup} label="Good with Dogs" id="dogs">
                    <select id="dogs" name="dogs" required>
                        <option value="1" selected=${animal?.dogs === 1 || animal?.dogs === '1'}>Yes</option>
                        <option value="0" selected=${animal?.dogs === 0 || animal?.dogs === '0'}>No</option>
                        <option value="?" selected=${animal?.dogs == null || animal?.dogs === '?'}>Unknown</option>
                    </select>
                <//>
                <${FormGroup} label="Good with Cats" id="cats">
                    <select id="cats" name="cats" required>
                        <option value="1" selected=${animal?.cats === 1 || animal?.cats === '1'}>Yes</option>
                        <option value="0" selected=${animal?.cats === 0 || animal?.cats === '0'}>No</option>
                        <option value="?" selected=${animal?.cats == null || animal?.cats === '?'}>Unknown</option>
                    </select>
                <//>
            <//>

            ${includeBio && html`
                <${FormGroup} label="Bio" id="bio">
                    <textarea
                        id="bio"
                        name="bio"
                        rows="4"
                        placeholder="Enter the animal's bio/description..."
                        style="resize: vertical; min-height: 80px;"
                    >${animal?.bio || ''}</textarea>
                <//>
            `}
        </form>
    `;
}

function getFormData(formRef, includeBio = true) {
    const form = formRef.current;
    if (!form) return null;
    const data = {
        name: form.name.value,
        breed: form.breed.value,
        slug: form.slug.value,
        age_long: form.age_long.value,
        age_short: form.age_short.value,
        size: form.size.value,
        gender: form.gender.value,
        shots: form.shots.value === '1',
        housetrained: form.housetrained.value === '1',
        kids: form.kids.value,
        dogs: form.dogs.value,
        cats: form.cats.value,
        rescue_id: parseInt(form.rescue_id.value, 10)
    };
    if (includeBio && form.bio) {
        data.bio = form.bio.value;
    }
    return data;
}

// ============================================================
// Create Animal Modal
// ============================================================
function CreateOptionsModal({ isOpen, onClose, onSelectManual, onSelectScrape, onSelectFromSite }) {
    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Create New Animal">
            <div class="create-options">
                <button class="option-button" onClick=${onSelectManual}>
                    <h3>Enter Data</h3>
                    <p>Manually enter all animal information and details</p>
                </button>
                <button class="option-button" onClick=${onSelectScrape}>
                    <h3>Scrape from URL</h3>
                    <p>Import animal data from an adoption website URL</p>
                </button>
                <button class="option-button" onClick=${onSelectFromSite}>
                    <h3>Select from Site</h3>
                    <p>Browse and select multiple animals from a rescue site</p>
                </button>
            </div>
        <//>
    `;
}

function RescueSelectModal({ isOpen, onClose, onSelect }) {
    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Select Rescue Organization">
            <div class="create-options">
                <button class="option-button" onClick=${() => onSelect('wagtopia')}>
                    <h3>Paws Rescue League</h3>
                    <p>Browse animals from Wagtopia</p>
                </button>
                <button class="option-button" onClick=${() => onSelect('adoptapet')}>
                    <h3>Brass City Rescue</h3>
                    <p>Browse animals from Adoptapet</p>
                </button>
            </div>
        <//>
    `;
}

function ScrapeModal({ isOpen, onClose, onScrape }) {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const showToast = useToast();

    const handleScrape = async () => {
        if (!url.trim()) {
            showToast('Please enter a URL', 'error');
            return;
        }
        setLoading(true);
        try {
            await onScrape(url.trim());
        } finally {
            setLoading(false);
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleScrape} disabled=${loading}>
            ${loading ? 'Scraping...' : 'Scrape Data'}
        </button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Scrape from URL" footer=${footer}>
            <${FormGroup} label="Adoption Page URL" id="scrapeUrl">
                <input
                    type="text"
                    id="scrapeUrl"
                    placeholder="https://example.com/adopt/dog-name"
                    value=${url}
                    onInput=${(e) => setUrl(e.target.value)}
                />
            <//>
            <p style="color: #666; font-size: 0.9rem; margin-top: 10px;">
                Enter the URL of an animal adoption page to automatically extract information.
            </p>
        <//>
    `;
}

function ManualEntryModal({ isOpen, onClose, rescues, initialData, onSubmit }) {
    const [imageData, setImageData] = useState(null);
    const formRef = useRef(null);
    const showToast = useToast();

    useEffect(() => {
        if (isOpen && initialData?.imageDataUrl) {
            setImageData({ dataUrl: initialData.imageDataUrl, ...initialData.imageData });
        } else if (!isOpen) {
            setImageData(null);
        }
    }, [isOpen, initialData]);

    const handleSubmit = () => {
        const data = getFormData(formRef);
        if (!data) return;

        const imageToSave = imageData ? { hex: imageData.hex, mime: imageData.mime, path: imageData.path } : null;

        try {
            db.createAnimal(data, imageToSave);
            showToast(`${data.name} created successfully!`);
            onClose();
            onSubmit();
        } catch (err) {
            showToast(`Error creating animal: ${err.message}`, 'error');
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSubmit}>Create Animal</button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Create New Animal" footer=${footer}>
            <${AnimalForm}
                animal=${initialData}
                rescues=${rescues}
                imageData=${imageData}
                onImageChange=${setImageData}
                formRef=${formRef}
            />
        <//>
    `;
}

// ============================================================
// Edit Animal Modal
// ============================================================
function EditAnimalModal({ isOpen, onClose, animal, rescues, onSubmit, onDelete }) {
    const [imageData, setImageData] = useState(null);
    const [showAttributesModal, setShowAttributesModal] = useState(false);
    const [showAIEditModal, setShowAIEditModal] = useState(false);
    const [showPhotoPickerModal, setShowPhotoPickerModal] = useState(false);
    const [rescraping, setRescraping] = useState(false);
    const [photoUrls, setPhotoUrls] = useState([]);
    const formRef = useRef(null);
    const showToast = useToast();

    // Load photo URLs when modal opens
    useEffect(() => {
        if (isOpen && animal?.id) {
            const urls = db.getAnimalPhotoUrls(animal.id);
            setPhotoUrls(urls);
        }
    }, [isOpen, animal?.id]);

    useEffect(() => {
        if (!isOpen) {
            setImageData(null);
            setShowAttributesModal(false);
            setShowAIEditModal(false);
            setShowPhotoPickerModal(false);
            setRescraping(false);
            setPhotoUrls([]);
        }
    }, [isOpen]);

    // Handle saving AI-edited image
    const handleAIEditSave = async (editedImageDataUrl) => {
        try {
            // Convert data URL to image data format
            const response = await fetch(editedImageDataUrl);
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const hex = Array.from(new Uint8Array(arrayBuffer))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            const mime = blob.type || 'image/png';

            setImageData({
                hex,
                mime,
                path: 'ai-edited',
                dataUrl: editedImageDataUrl
            });
        } catch (err) {
            console.error('Error processing AI edited image:', err);
        }
    };

    // Get current image URL for AI edit modal
    const getCurrentImageUrl = () => {
        return imageData?.dataUrl || animal?.imageDataUrl || null;
    };

    const handleRescrape = async () => {
        if (!animal || !formRef.current) return;

        const form = formRef.current;
        const url = form.slug.value;
        if (!url) {
            showToast('No adoption URL to scrape from.', 'error');
            return;
        }

        // Get the rescue to determine scraper type
        const rescue = rescues.find(r => r.id === animal.rescue_id);
        if (!rescue || !rescue.scraper_type) {
            showToast('Cannot determine scraper type for this rescue.', 'error');
            return;
        }

        setRescraping(true);
        try {
            const ipcChannel = rescue.scraper_type === 'adoptapet'
                ? 'scrape-animal-page-adoptapet'
                : 'scrape-animal-page-wagtopia';

            const result = await ipcRenderer.invoke(ipcChannel, url);
            if (!result.success) throw new Error(result.error);

            const scrapedData = result.data;

            // Update form fields
            form.name.value = scrapedData.name || form.name.value;
            form.breed.value = scrapedData.breed || form.breed.value;
            form.age_long.value = scrapedData.age_long || form.age_long.value;
            form.age_short.value = scrapedData.age_short || form.age_short.value;
            form.size.value = scrapedData.size || form.size.value;
            form.gender.value = scrapedData.gender || form.gender.value;
            form.shots.value = scrapedData.shots ? '1' : '0';
            form.housetrained.value = scrapedData.housetrained ? '1' : '0';
            form.kids.value = scrapedData.kids || '?';
            form.dogs.value = scrapedData.dogs || '?';
            form.cats.value = scrapedData.cats || '?';
            if (bioRef.current) {
                bioRef.current.value = scrapedData.bio || '';
            }

            // Update image if available
            if (scrapedData.imageUrl) {
                try {
                    const imageResponse = await fetch(scrapedData.imageUrl);
                    const imageBlob = await imageResponse.blob();
                    const arrayBuffer = await imageBlob.arrayBuffer();
                    const hex = Array.from(new Uint8Array(arrayBuffer))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    const mime = imageBlob.type || 'image/jpeg';
                    const dataUrl = `data:${mime};base64,${btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))}`;

                    setImageData({
                        hex,
                        mime,
                        path: scrapedData.imageUrl,
                        dataUrl
                    });
                } catch (imgErr) {
                    console.error('Error fetching image:', imgErr);
                }
            }

            // Update attributes if present
            if (scrapedData.attributes && scrapedData.attributes.length > 0) {
                db.updateAnimalAttributes(animal.id, scrapedData.attributes);
            }

            // Update photo URLs if present
            if (scrapedData.photoUrls && scrapedData.photoUrls.length > 0) {
                db.updateAnimalPhotoUrls(animal.id, scrapedData.photoUrls);
                setPhotoUrls(scrapedData.photoUrls);
            }

            showToast('Data refreshed from adoption page!');
        } catch (err) {
            showToast(`Error scraping: ${err.message}`, 'error');
        } finally {
            setRescraping(false);
        }
    };

    // Ref to track bio textarea value
    const bioRef = useRef(null);

    const handleSave = () => {
        const data = getFormData(formRef, false); // Don't include bio from form
        if (!data || !animal) return;

        // Get bio from the separate textarea ref
        data.bio = bioRef.current?.value || '';

        const imageToSave = imageData ? { hex: imageData.hex, mime: imageData.mime, path: imageData.path } : null;

        try {
            db.updateAnimal(animal.id, data, imageToSave);
            showToast(`${data.name} updated successfully!`);
            onClose();
            onSubmit();
        } catch (err) {
            showToast(`Error saving: ${err.message}`, 'error');
        }
    };

    const handleDelete = () => {
        if (!animal) return;
        if (!confirm(`Are you sure you want to delete ${animal.name}? This cannot be undone.`)) return;

        try {
            db.deleteAnimal(animal.id);
            showToast(`${animal.name} deleted successfully!`);
            onClose();
            onDelete();
        } catch (err) {
            showToast(`Error deleting: ${err.message}`, 'error');
        }
    };

    const footer = html`
        <button class="btn btn-danger" onClick=${handleDelete}>Delete</button>
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSave}>Save Changes</button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} footer=${footer} width="900px">
            <div class="modal-two-column">
                <div class="modal-column-left">
                    <${AnimalForm}
                        key=${animal?.id}
                        animal=${animal}
                        rescues=${rescues}
                        imageData=${imageData}
                        onImageChange=${setImageData}
                        formRef=${formRef}
                        onAIEdit=${() => setShowAIEditModal(true)}
                        onSelectFromWebsite=${() => setShowPhotoPickerModal(true)}
                        photoUrls=${photoUrls}
                        includeBio=${false}
                    />
                </div>
                <div class="modal-column-right edit-animal-right-column">
                    <${FormGroup} label="Bio" id="bio-edit">
                        <textarea
                            ref=${bioRef}
                            id="bio-edit"
                            placeholder="Enter the animal's bio/description..."
                            defaultValue=${animal?.bio || ''}
                        ></textarea>
                    <//>
                    <div class="edit-animal-buttons">
                        <button
                            class="btn btn-secondary"
                            onClick=${() => setShowAttributesModal(true)}
                        >
                            Edit Flyer Attributes
                        </button>
                        <button
                            class="btn btn-secondary"
                            onClick=${handleRescrape}
                            disabled=${rescraping}
                        >
                            ${rescraping ? 'Refreshing...' : 'Re-scrape from URL'}
                        </button>
                    </div>
                </div>
            </div>
        <//>
        <${EditAttributesModal}
            isOpen=${showAttributesModal}
            onClose=${() => setShowAttributesModal(false)}
            animalId=${animal?.id}
            animalName=${animal?.name}
            onSave=${() => {}}
        />
        <${AIEditImageModal}
            isOpen=${showAIEditModal}
            onClose=${() => setShowAIEditModal(false)}
            imageUrl=${getCurrentImageUrl()}
            onSave=${handleAIEditSave}
        />
        <${PhotoPickerModal}
            isOpen=${showPhotoPickerModal}
            onClose=${() => setShowPhotoPickerModal(false)}
            photoUrls=${photoUrls}
            onSelect=${setImageData}
        />
    `;
}

// ============================================================
// Edit Attributes Modal
// ============================================================
function EditAttributesModal({ isOpen, onClose, animalId, animalName, onSave }) {
    const [attributes, setAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const showToast = useToast();

    const handleGenerateWithAI = async () => {
        // Get the API key from settings
        const apiKey = db.getSetting('openai_api_key');
        if (!apiKey) {
            showToast('Please set your OpenAI API key in Settings first.', 'error');
            return;
        }

        // Get the animal's bio
        const animal = db.getAnimalById(animalId);
        if (!animal || !animal.bio) {
            showToast('This animal has no bio to generate attributes from.', 'error');
            return;
        }

        setGenerating(true);
        try {
            const prompt = `Given the following bio for this adoptable pet, return exactly 16 traits as a newline-separated list. Each trait should start with an uppercase letter.

            First, fill slots with positive, eloquent adjectives that describe the animal's personality based on the bio (e.g., Loyal, Playful, Cuddly, Loving, High Energy).

            Then, always end with these 7 factual attributes:
            - Housebroken (or "Not housebroken" if not mentioned)
            - Good with kids/cats/dogs (list whichever apply, or don't include if not mentioned)
            - Spayed/Neutered if mentioned, otherwise omit this field
            - Medically UTD
            - Microchipped
            - Approx XXlbs (use weight from bio, or "Weight unknown" if not mentioned)
            - Size in format "Medium sized dog" or "Small sized cat" (use size and animal type from bio)

            The first 9 slots should be personality adjectives, and the last 7 slots should be the factual attributes listed above. do not stray from the verbiage supplied.

            Only respond with the newline-separated list of 16 traits.\n\nBio:\n${animal.bio}`;

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4.1-mini',
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            // Parse the newline-separated response
            const generatedAttrs = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .slice(0, 16);

            // Pad to 16 slots if needed
            while (generatedAttrs.length < 16) {
                generatedAttrs.push('');
            }

            setAttributes(generatedAttrs);
            showToast('Attributes generated successfully!');
        } catch (err) {
            showToast(`Error generating attributes: ${err.message}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    useEffect(() => {
        if (!isOpen || !animalId) return;
        setLoading(true);
        try {
            const attrs = db.getAnimalAttributes(animalId);
            // Ensure we have an array of 16 slots (empty strings for unfilled)
            const padded = [...attrs];
            while (padded.length < 16) padded.push('');
            setAttributes(padded);
        } catch (err) {
            showToast(`Error loading attributes: ${err.message}`, 'error');
            setAttributes(Array(16).fill(''));
        } finally {
            setLoading(false);
        }
    }, [isOpen, animalId]);

    const handleChange = (index, value) => {
        setAttributes(prev => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

    const handleMoveUp = (index) => {
        if (index === 0) return;
        setAttributes(prev => {
            const next = [...prev];
            [next[index - 1], next[index]] = [next[index], next[index - 1]];
            return next;
        });
    };

    const handleMoveDown = (index) => {
        if (index >= 15) return;
        setAttributes(prev => {
            const next = [...prev];
            [next[index], next[index + 1]] = [next[index + 1], next[index]];
            return next;
        });
    };

    const handleDelete = (index) => {
        setAttributes(prev => {
            const next = [...prev];
            next.splice(index, 1);
            next.push(''); // Keep 16 slots
            return next;
        });
    };

    const handleSave = () => {
        try {
            // Filter out empty strings and save
            const cleanAttrs = attributes.filter(a => a.trim());
            db.updateAnimalAttributes(animalId, cleanAttrs);
            showToast('Attributes saved successfully!');
            onSave && onSave();
            onClose();
        } catch (err) {
            showToast(`Error saving attributes: ${err.message}`, 'error');
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSave}>Save Attributes</button>
    `;

    const filledCount = attributes.filter(a => a.trim()).length;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title=${`Edit Attributes - ${animalName || 'Animal'}`} footer=${footer} width="600px">
            <p style="color: #666; margin-bottom: 15px;">
                Add up to 16 attributes that will appear on the adoption flyer.
                These are displayed as a list of traits (e.g., "Labrador Mix", "2 Years", "Housetrained").
            </p>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <p style="color: #888; font-size: 0.85rem; margin: 0;">
                    ${filledCount}/16 attributes used
                </p>
                <button
                    class="btn btn-secondary"
                    onClick=${handleGenerateWithAI}
                    disabled=${generating || loading}
                    style="padding: 8px 16px; font-size: 0.85rem;"
                >
                    ${generating ? 'Generating...' : 'Generate with AI'}
                </button>
            </div>
            ${loading ? html`<p>Loading...</p>` : html`
                <div class="attributes-list">
                    ${attributes.map((attr, i) => html`
                        <div key=${i} class="attribute-row" style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
                            <span style="width: 24px; color: #888; font-size: 0.85rem;">${i + 1}.</span>
                            <input
                                type="text"
                                value=${attr}
                                onInput=${(e) => handleChange(i, e.target.value)}
                                placeholder=${`Attribute ${i + 1}`}
                                style="flex: 1;"
                                maxlength="50"
                            />
                            <button
                                class="btn btn-small"
                                onClick=${() => handleMoveUp(i)}
                                disabled=${i === 0}
                                title="Move up"
                                style="padding: 4px 8px;"
                            >↑</button>
                            <button
                                class="btn btn-small"
                                onClick=${() => handleMoveDown(i)}
                                disabled=${i >= 15}
                                title="Move down"
                                style="padding: 4px 8px;"
                            >↓</button>
                            <button
                                class="btn btn-small btn-danger"
                                onClick=${() => handleDelete(i)}
                                title="Remove"
                                style="padding: 4px 8px;"
                            >×</button>
                        </div>
                    `)}
                </div>
            `}
        <//>
    `;
}

// ============================================================
// Select From Site Modal
// ============================================================
function SelectFromSiteModal({ isOpen, onClose, selectedRescue, onImportComplete }) {
    const [animals, setAnimals] = useState([]);
    const [selectedUrls, setSelectedUrls] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [importStatus, setImportStatus] = useState('');
    const showToast = useToast();

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        setAnimals([]);
        setSelectedUrls(new Set());

        (async () => {
            try {
                const rescue = db.getRescueByScraperType(selectedRescue);
                if (!rescue) throw new Error(`Rescue not found for scraper type: ${selectedRescue}`);

                const ipcChannel = selectedRescue === 'adoptapet'
                    ? 'scrape-animal-list-adoptapet'
                    : 'scrape-animal-list-wagtopia';

                const result = await ipcRenderer.invoke(ipcChannel, rescue.org_id);
                if (!result.success) throw new Error(result.error);

                setAnimals(result.data);
            } catch (err) {
                showToast(`Error loading animals: ${err.message}`, 'error');
            } finally {
                setLoading(false);
            }
        })();
    }, [isOpen, selectedRescue]);

    const toggleSelection = (url) => {
        setSelectedUrls(prev => {
            const next = new Set(prev);
            if (next.has(url)) next.delete(url);
            else next.add(url);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedUrls.size === animals.length) {
            setSelectedUrls(new Set());
        } else {
            setSelectedUrls(new Set(animals.map(a => a.url)));
        }
    };

    const handleImport = async () => {
        if (selectedUrls.size === 0) {
            showToast('Please select at least one animal', 'error');
            return;
        }

        setImporting(true);
        let successCount = 0;
        let failCount = 0;
        const urls = Array.from(selectedUrls);

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const animalName = animals.find(a => a.url === url)?.name || 'Unknown';
            setImportStatus(`Importing ${i + 1}/${urls.length}: ${animalName}`);

            try {
                const ipcChannel = selectedRescue === 'adoptapet'
                    ? 'scrape-animal-page-adoptapet'
                    : 'scrape-animal-page-wagtopia';

                const result = await ipcRenderer.invoke(ipcChannel, url);
                if (!result.success) throw new Error(result.error);

                const scrapedData = result.data;
                let imageData = null;

                if (scrapedData.imagePath) {
                    try {
                        const imagePath = path.isAbsolute(scrapedData.imagePath)
                            ? scrapedData.imagePath
                            : path.join(APP_PATH, scrapedData.imagePath);
                        const buffer = fs.readFileSync(imagePath);
                        imageData = bufferToImageData(buffer, imagePath);
                        fs.unlinkSync(imagePath);
                    } catch (imgErr) {
                        console.error('Error loading image:', imgErr);
                    }
                }

                const rescue = db.getRescueByScraperType(selectedRescue);
                const animalData = {
                    name: scrapedData.name,
                    breed: scrapedData.breed,
                    slug: scrapedData.slug,
                    age_long: scrapedData.age_long,
                    age_short: scrapedData.age_short,
                    size: scrapedData.size,
                    gender: scrapedData.gender,
                    shots: scrapedData.shots,
                    housetrained: scrapedData.housetrained,
                    kids: scrapedData.kids,
                    dogs: scrapedData.dogs,
                    cats: scrapedData.cats,
                    bio: scrapedData.bio || '',
                    rescue_id: rescue?.id || 1,
                    attributes: scrapedData.attributes || [],
                    photoUrls: scrapedData.photoUrls || []
                };

                db.createAnimal(animalData, imageData ? { hex: imageData.hex, mime: imageData.mime, path: imageData.path } : null);
                successCount++;
            } catch (err) {
                console.error(`Error importing ${animalName}:`, err);
                failCount++;
            }
        }

        setImporting(false);
        setImportStatus('');

        const message = `Import complete: ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}`;
        showToast(message, failCount > 0 ? 'error' : 'success');

        onClose();
        onImportComplete();
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose} disabled=${importing}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleImport} disabled=${importing || selectedUrls.size === 0}>
            ${importing ? importStatus : `Import Selected (${selectedUrls.size})`}
        </button>
    `;

    const rescueName = selectedRescue === 'adoptapet' ? 'Adoptapet' : 'Wagtopia';

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Select Animals from ${rescueName}" footer=${footer}>
            ${loading ? html`
                <div class="loading-spinner">Loading animals from ${rescueName}</div>
            ` : animals.length === 0 ? html`
                <div style="padding: 20px; text-align: center; color: #666;">No animals found.</div>
            ` : html`
                <div class="select-all-container">
                    <label>
                        <input
                            type="checkbox"
                            checked=${selectedUrls.size === animals.length}
                            onChange=${toggleSelectAll}
                        />
                        Select All
                    </label>
                </div>
                <div class="animal-select-list">
                    ${animals.map(animal => html`
                        <div
                            key=${animal.url}
                            class="animal-select-item ${selectedUrls.has(animal.url) ? 'selected' : ''}"
                            onClick=${() => toggleSelection(animal.url)}
                        >
                            <input
                                type="checkbox"
                                checked=${selectedUrls.has(animal.url)}
                                onChange=${(e) => { e.stopPropagation(); toggleSelection(animal.url); }}
                            />
                            <label>${animal.name}</label>
                        </div>
                    `)}
                </div>
            `}
        <//>
    `;
}

// ============================================================
// Delete Multiple Modal
// ============================================================
function DeleteMultipleModal({ isOpen, onClose, animals, onDeleteComplete }) {
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [deleting, setDeleting] = useState(false);
    const showToast = useToast();

    useEffect(() => {
        if (!isOpen) setSelectedIds(new Set());
    }, [isOpen]);

    const toggleSelection = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === animals.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(animals.map(a => a.id)));
        }
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) {
            showToast('Please select at least one animal', 'error');
            return;
        }

        const count = selectedIds.size;
        const names = animals.filter(a => selectedIds.has(a.id)).map(a => a.name).slice(0, 3).join(', ');
        const displayNames = count > 3 ? `${names} and ${count - 3} more` : names;

        if (!confirm(`Are you sure you want to delete ${count} animal${count > 1 ? 's' : ''}?\n\n${displayNames}\n\nThis cannot be undone.`)) {
            return;
        }

        setDeleting(true);
        try {
            const { successCount, failCount } = db.deleteAnimals(Array.from(selectedIds));
            const message = `Deleted ${successCount} animal${successCount !== 1 ? 's' : ''}${failCount > 0 ? `, ${failCount} failed` : ''}`;
            showToast(message, failCount > 0 ? 'error' : 'success');
            onClose();
            onDeleteComplete();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setDeleting(false);
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose} disabled=${deleting}>Cancel</button>
        <button class="btn btn-danger" onClick=${handleDelete} disabled=${deleting || selectedIds.size === 0}>
            ${deleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
        </button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Delete Multiple Animals" footer=${footer}>
            <div class="select-all-container">
                <label>
                    <input
                        type="checkbox"
                        checked=${selectedIds.size === animals.length && animals.length > 0}
                        onChange=${toggleSelectAll}
                    />
                    Select All
                </label>
            </div>
            <div class="delete-animal-grid">
                ${animals.map(animal => html`
                    <div
                        key=${animal.id}
                        class="delete-animal-item ${selectedIds.has(animal.id) ? 'selected' : ''}"
                        onClick=${() => toggleSelection(animal.id)}
                    >
                        <input
                            type="checkbox"
                            checked=${selectedIds.has(animal.id)}
                            onClick=${(e) => e.stopPropagation()}
                            onChange=${() => toggleSelection(animal.id)}
                        />
                        ${animal.imageDataUrl
                            ? html`<img class="delete-animal-thumbnail" src=${animal.imageDataUrl} alt=${animal.name} />`
                            : html`<div class="delete-animal-no-image">🐕</div>`
                        }
                        <div class="delete-animal-name">${animal.name}</div>
                    </div>
                `)}
            </div>
        <//>
    `;
}

// ============================================================
// Print Settings Modal
// ============================================================
function PrintSettingsModal({ isOpen, onClose, filePath, onPrintComplete, templateConfig }) {
    const [printers, setPrinters] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const [selectedProfile, setSelectedProfile] = useState('');
    const [copies, setCopies] = useState(1);
    const [paperSize, setPaperSize] = useState('letter');
    const [orientation, setOrientation] = useState('landscape');
    const [paperSource, setPaperSource] = useState('default');
    const [loading, setLoading] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [showManageProfiles, setShowManageProfiles] = useState(false);
    const [showSaveProfile, setShowSaveProfile] = useState(false);
    const showToast = useToast();

    // Template-driven settings (locked when template provides them)
    const templatePaperSize = templateConfig?.paperSize || null;
    const templateOrientation = templateConfig?.orientation || null;
    const isTemplateLocked = !!(templatePaperSize || templateOrientation);

    // Apply template settings when modal opens
    useEffect(() => {
        if (isOpen && templateConfig) {
            if (templateConfig.paperSize) setPaperSize(templateConfig.paperSize);
            if (templateConfig.orientation) setOrientation(templateConfig.orientation);
        }
    }, [isOpen, templateConfig]);

    // Load printers on open
    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        (async () => {
            try {
                const result = await ipcRenderer.invoke('get-printers');
                if (result.success) {
                    setPrinters(result.printers);
                    const defaultPrinter = result.printers.find(p => p.isDefault);
                    if (defaultPrinter) {
                        setSelectedPrinter(defaultPrinter.name);
                    }
                }
            } catch (err) {
                showToast(`Error loading printers: ${err.message}`, 'error');
            } finally {
                setLoading(false);
            }
        })();
    }, [isOpen]);

    // Load profiles when printer changes
    useEffect(() => {
        if (!selectedPrinter) {
            setProfiles([]);
            return;
        }
        (async () => {
            try {
                const result = await ipcRenderer.invoke('get-print-profiles', selectedPrinter);
                if (result.success) {
                    setProfiles(result.profiles);
                    const defaultProfile = result.profiles.find(p => p.is_default);
                    if (defaultProfile) {
                        setSelectedProfile(defaultProfile.id.toString());
                        applyProfile(defaultProfile);
                    }
                }
            } catch (err) {
                console.error('Error loading profiles:', err);
            }
        })();
    }, [selectedPrinter]);

    const applyProfile = (profile) => {
        if (!profile) return;
        setCopies(profile.copies || 1);
        setPaperSize(profile.paper_size || 'letter');
        setOrientation(profile.orientation || 'landscape');
        setPaperSource(profile.paper_source || 'default');
    };

    const handleProfileChange = (profileId) => {
        setSelectedProfile(profileId);
        const profile = profiles.find(p => p.id.toString() === profileId);
        if (profile) applyProfile(profile);
    };

    const handlePrint = async () => {
        if (!selectedPrinter) {
            showToast('Please select a printer', 'error');
            return;
        }

        setPrinting(true);
        try {
            const profile = profiles.find(p => p.id.toString() === selectedProfile);
            const printOptions = {
                showDialog: false,
                printer: selectedPrinter,
                copies,
                paperSize,
                orientation,
                paperSource,
                calibration_ab: profile?.calibration_ab || null,
                calibration_bc: profile?.calibration_bc || null,
                calibration_cd: profile?.calibration_cd || null,
                calibration_da: profile?.calibration_da || null,
                border_top: profile?.border_top || null,
                border_right: profile?.border_right || null,
                border_bottom: profile?.border_bottom || null,
                border_left: profile?.border_left || null,
                // Pass template page dimensions for correct sizing
                pageWidthInches: templateConfig?.pageWidthInches,
                pageHeightInches: templateConfig?.pageHeightInches
            };

            const result = await ipcRenderer.invoke('print-image', filePath, printOptions);
            if (result.success) {
                showToast('Sent to printer!', 'success');
                onClose();
                if (onPrintComplete) onPrintComplete(true);
            } else {
                showToast(`Print error: ${result.error}`, 'error');
            }
        } catch (err) {
            showToast(`Print error: ${err.message}`, 'error');
        } finally {
            setPrinting(false);
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handlePrint} disabled=${printing || !selectedPrinter}>
            ${printing ? 'Printing...' : 'Print'}
        </button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Print Settings" footer=${footer} width="850px">
            <div class="modal-two-column">
                <div class="modal-column-left">
                    <div class="printer-row">
                        <${FormGroup} label="Printer" id="printer">
                            <select
                                id="printer"
                                value=${selectedPrinter}
                                onChange=${(e) => setSelectedPrinter(e.target.value)}
                            >
                                ${loading
                                    ? html`<option value="">Loading printers...</option>`
                                    : printers.length === 0
                                        ? html`<option value="">No printers found</option>`
                                        : printers.map(p => html`
                                            <option key=${p.name} value=${p.name}>
                                                ${p.name}${p.isDefault ? ' (Default)' : ''}
                                            </option>
                                        `)
                                }
                            </select>
                        <//>
                        <button
                            type="button"
                            class="btn btn-icon"
                            onClick=${() => setLoading(true)}
                            title="Refresh printers"
                        >
                            🔄
                        </button>
                    </div>

                    <div class="profile-row">
                        <${FormGroup} label="Profile" id="profile">
                            <select
                                id="profile"
                                value=${selectedProfile}
                                onChange=${(e) => handleProfileChange(e.target.value)}
                            >
                                <option value="">No profile selected</option>
                                ${profiles.map(p => {
                                    const isCalibrated = p.calibration_ab && p.calibration_bc && p.calibration_cd && p.calibration_da;
                                    return html`
                                        <option key=${p.id} value=${p.id}>
                                            ${p.name}${p.is_default ? ' (Default)' : ''}${isCalibrated ? ' [Cal]' : ''}
                                        </option>
                                    `;
                                })}
                            </select>
                        <//>
                        <div class="profile-buttons">
                            <button
                                type="button"
                                class="btn btn-secondary"
                                onClick=${() => setShowSaveProfile(true)}
                            >
                                Save
                            </button>
                            <button
                                type="button"
                                class="btn btn-secondary"
                                onClick=${() => setShowManageProfiles(true)}
                            >
                                Manage
                            </button>
                        </div>
                    </div>

                    ${isTemplateLocked && html`
                        <div class="template-info-section">
                            <div class="template-info-header">
                                <span class="template-info-icon">📄</span>
                                <span class="template-info-title">Template Settings</span>
                            </div>
                            <div class="template-info-details">
                                ${templatePaperSize && html`<span class="template-info-item">Paper: ${getPaperSizeLabel(templatePaperSize)}</span>`}
                                ${templateOrientation && html`<span class="template-info-item">Orientation: ${capitalizeFirst(templateOrientation)}</span>`}
                            </div>
                        </div>
                    `}

                    <${FormRow}>
                        <${FormGroup} label="Copies" id="copies">
                            <input
                                type="number"
                                id="copies"
                                min="1"
                                max="99"
                                value=${copies}
                                onInput=${(e) => setCopies(parseInt(e.target.value) || 1)}
                            />
                        <//>
                        <${FormGroup} label="Paper Size" id="paperSize">
                            <select
                                id="paperSize"
                                value=${paperSize}
                                onChange=${(e) => setPaperSize(e.target.value)}
                                disabled=${!!templatePaperSize}
                                class=${templatePaperSize ? 'locked-by-template' : ''}
                            >
                                <option value="letter">Letter (8.5 x 11 in)</option>
                                <option value="legal">Legal (8.5 x 14 in)</option>
                                <option value="A4">A4 (210 x 297 mm)</option>
                                <option value="A5">A5 (148 x 210 mm)</option>
                            </select>
                        <//>
                    <//>

                    <${FormGroup} label="Orientation" id="orientation">
                        <div class="orientation-options ${templateOrientation ? 'locked-by-template' : ''}">
                            <label class="orientation-option">
                                <input
                                    type="radio"
                                    name="orientation"
                                    value="landscape"
                                    checked=${orientation === 'landscape'}
                                    onChange=${() => setOrientation('landscape')}
                                    disabled=${!!templateOrientation}
                                />
                                <span class="orientation-icon orientation-landscape"></span>
                                <span>Landscape</span>
                            </label>
                            <label class="orientation-option">
                                <input
                                    type="radio"
                                    name="orientation"
                                    value="portrait"
                                    checked=${orientation === 'portrait'}
                                    onChange=${() => setOrientation('portrait')}
                                    disabled=${!!templateOrientation}
                                />
                                <span class="orientation-icon orientation-portrait"></span>
                                <span>Portrait</span>
                            </label>
                        </div>
                    <//>

                    <${FormGroup} label="Paper Source" id="paperSource">
                        <select
                            id="paperSource"
                            value=${paperSource}
                            onChange=${(e) => setPaperSource(e.target.value)}
                        >
                            <option value="default">Default</option>
                            <option value="rear">Rear Tray</option>
                        </select>
                    <//>
                </div>

                <div class="modal-column-right print-modal-right-column">
                    <div class="print-preview-container">
                        <img
                            class="print-preview-image"
                            src=${filePath ? `file:///${filePath.replace(/\\/g, '/')}` : ''}
                            alt="Print preview"
                        />
                    </div>
                </div>
            </div>

            <${ManageProfilesModal}
                isOpen=${showManageProfiles}
                onClose=${() => setShowManageProfiles(false)}
                printers=${printers}
                selectedPrinter=${selectedPrinter}
            />

            <${SaveProfileModal}
                isOpen=${showSaveProfile}
                onClose=${() => setShowSaveProfile(false)}
                printerName=${selectedPrinter}
                currentSettings=${{ copies, paperSize, orientation, paperSource }}
                onSave=${() => {
                    // Reload profiles
                    if (selectedPrinter) {
                        ipcRenderer.invoke('get-print-profiles', selectedPrinter).then(result => {
                            if (result.success) setProfiles(result.profiles);
                        });
                    }
                }}
            />
        <//>
    `;
}

// ============================================================
// Manage Profiles Modal
// ============================================================
function ManageProfilesModal({ isOpen, onClose, printers, selectedPrinter: initialPrinter }) {
    const [selectedPrinter, setSelectedPrinter] = useState(initialPrinter || '');
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingProfile, setEditingProfile] = useState(null);
    const showToast = useToast();

    useEffect(() => {
        if (isOpen && initialPrinter) {
            setSelectedPrinter(initialPrinter);
        }
    }, [isOpen, initialPrinter]);

    useEffect(() => {
        if (!selectedPrinter) {
            setProfiles([]);
            return;
        }
        loadProfiles();
    }, [selectedPrinter]);

    const loadProfiles = async () => {
        if (!selectedPrinter) return;
        setLoading(true);
        try {
            const result = await ipcRenderer.invoke('get-print-profiles', selectedPrinter);
            if (result.success) setProfiles(result.profiles);
        } catch (err) {
            console.error('Error loading profiles:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSetDefault = async (profileId) => {
        try {
            const result = await ipcRenderer.invoke('set-default-print-profile', profileId);
            if (result.success) {
                showToast('Default profile updated!', 'success');
                loadProfiles();
            } else {
                showToast(`Error: ${result.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handleDelete = async (profileId) => {
        if (!confirm('Are you sure you want to delete this profile?')) return;
        try {
            const result = await ipcRenderer.invoke('delete-print-profile', profileId);
            if (result.success) {
                showToast('Profile deleted!', 'success');
                loadProfiles();
            } else {
                showToast(`Error: ${result.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handleCopy = async (profileId) => {
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return;

        try {
            const result = await ipcRenderer.invoke('save-print-profile', {
                ...profile,
                id: null,
                name: `${profile.name} (Copy)`,
                is_default: false
            });
            if (result.success) {
                showToast('Profile copied!', 'success');
                loadProfiles();
            } else {
                showToast(`Error: ${result.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Close</button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Manage Print Profiles" footer=${footer} width="550px">
            <${FormGroup} label="Printer" id="managePrinter">
                <select
                    id="managePrinter"
                    value=${selectedPrinter}
                    onChange=${(e) => setSelectedPrinter(e.target.value)}
                >
                    <option value="">Select a printer...</option>
                    ${printers.map(p => html`
                        <option key=${p.name} value=${p.name}>
                            ${p.name}${p.isDefault ? ' (Default)' : ''}
                        </option>
                    `)}
                </select>
            <//>

            <div class="profile-list">
                ${!selectedPrinter ? html`
                    <div class="profile-empty">Select a printer to view profiles</div>
                ` : loading ? html`
                    <div class="profile-empty">Loading...</div>
                ` : profiles.length === 0 ? html`
                    <div class="profile-empty">No profiles for this printer</div>
                ` : profiles.map(profile => {
                    const isCalibrated = profile.calibration_ab && profile.calibration_bc &&
                                        profile.calibration_cd && profile.calibration_da;
                    return html`
                        <div key=${profile.id} class="profile-item">
                            <div class="profile-item-info">
                                <div class="profile-item-name">
                                    ${profile.name}
                                    ${profile.is_default && html`<span class="default-badge">Default</span>`}
                                    ${isCalibrated && html`<span class="default-badge" style="background: #28a745;">Calibrated</span>`}
                                </div>
                                <div class="profile-item-settings">
                                    ${getPaperSizeLabel(profile.paper_size)}, ${capitalizeFirst(profile.orientation)}, ${profile.copies} ${profile.copies === 1 ? 'copy' : 'copies'}
                                </div>
                            </div>
                            <div class="profile-item-actions">
                                ${!profile.is_default && html`
                                    <button class="btn btn-secondary" onClick=${() => handleSetDefault(profile.id)}>Set Default</button>
                                `}
                                <button class="btn btn-secondary" onClick=${() => handleCopy(profile.id)}>Copy</button>
                                <button class="btn btn-secondary" onClick=${() => setEditingProfile(profile)}>Edit</button>
                                <button class="btn btn-danger-outline" onClick=${() => handleDelete(profile.id)}>Delete</button>
                            </div>
                        </div>
                    `;
                })}
            </div>

            ${selectedPrinter && html`
                <button
                    type="button"
                    class="btn btn-primary"
                    onClick=${() => setEditingProfile({ printer_name: selectedPrinter })}
                    style="margin-top: 15px;"
                >
                    + New Profile
                </button>
            `}

            <${SaveProfileModal}
                isOpen=${!!editingProfile}
                onClose=${() => setEditingProfile(null)}
                printerName=${selectedPrinter}
                profile=${editingProfile}
                onSave=${loadProfiles}
            />
        <//>
    `;
}

// ============================================================
// Save Profile Modal
// ============================================================
function SaveProfileModal({ isOpen, onClose, printerName, profile, currentSettings, onSave }) {
    const [name, setName] = useState('');
    const [copies, setCopies] = useState(1);
    const [paperSize, setPaperSize] = useState('letter');
    const [orientation, setOrientation] = useState('landscape');
    const [paperSource, setPaperSource] = useState('default');
    const [isDefault, setIsDefault] = useState(false);
    const [calibrationAB, setCalibrationAB] = useState('100');
    const [calibrationBC, setCalibrationBC] = useState('100');
    const [calibrationCD, setCalibrationCD] = useState('100');
    const [calibrationDA, setCalibrationDA] = useState('100');
    const [borderTop, setBorderTop] = useState('');
    const [borderRight, setBorderRight] = useState('');
    const [borderBottom, setBorderBottom] = useState('');
    const [borderLeft, setBorderLeft] = useState('');
    const [saving, setSaving] = useState(false);
    const showToast = useToast();

    useEffect(() => {
        if (!isOpen) return;
        if (profile?.id) {
            // Editing existing profile
            setName(profile.name || '');
            setCopies(profile.copies || 1);
            setPaperSize(profile.paper_size || 'letter');
            setOrientation(profile.orientation || 'landscape');
            setPaperSource(profile.paper_source || 'default');
            setIsDefault(profile.is_default || false);
            setCalibrationAB(profile.calibration_ab?.toString() || '100');
            setCalibrationBC(profile.calibration_bc?.toString() || '100');
            setCalibrationCD(profile.calibration_cd?.toString() || '100');
            setCalibrationDA(profile.calibration_da?.toString() || '100');
            setBorderTop(profile.border_top?.toString() || '');
            setBorderRight(profile.border_right?.toString() || '');
            setBorderBottom(profile.border_bottom?.toString() || '');
            setBorderLeft(profile.border_left?.toString() || '');
        } else if (currentSettings) {
            // New profile from current settings
            setName('');
            setCopies(currentSettings.copies || 1);
            setPaperSize(currentSettings.paperSize || 'letter');
            setOrientation(currentSettings.orientation || 'landscape');
            setPaperSource(currentSettings.paperSource || 'default');
            setIsDefault(false);
            setCalibrationAB('100');
            setCalibrationBC('100');
            setCalibrationCD('100');
            setCalibrationDA('100');
            setBorderTop('');
            setBorderRight('');
            setBorderBottom('');
            setBorderLeft('');
        } else {
            // New profile with defaults
            setName('');
            setCopies(1);
            setPaperSize('letter');
            setOrientation('landscape');
            setPaperSource('default');
            setIsDefault(false);
            setCalibrationAB('100');
            setCalibrationBC('100');
            setCalibrationCD('100');
            setCalibrationDA('100');
            setBorderTop('');
            setBorderRight('');
            setBorderBottom('');
            setBorderLeft('');
        }
    }, [isOpen, profile, currentSettings]);

    const handleSave = async () => {
        if (!name.trim()) {
            showToast('Please enter a profile name', 'error');
            return;
        }

        setSaving(true);
        try {
            const profileData = {
                id: profile?.id || null,
                name: name.trim(),
                printer_name: printerName,
                copies,
                paper_size: paperSize,
                orientation,
                paper_source: paperSource,
                is_default: isDefault,
                calibration_ab: parseFloat(calibrationAB) || null,
                calibration_bc: parseFloat(calibrationBC) || null,
                calibration_cd: parseFloat(calibrationCD) || null,
                calibration_da: parseFloat(calibrationDA) || null,
                border_top: borderTop ? parseFloat(borderTop) : null,
                border_right: borderRight ? parseFloat(borderRight) : null,
                border_bottom: borderBottom ? parseFloat(borderBottom) : null,
                border_left: borderLeft ? parseFloat(borderLeft) : null
            };

            const result = await ipcRenderer.invoke('save-print-profile', profileData);
            if (result.success) {
                showToast(profile?.id ? 'Profile updated!' : 'Profile saved!', 'success');
                onClose();
                if (onSave) onSave();
            } else {
                showToast(`Error: ${result.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handlePrintCalibration = async () => {
        try {
            showToast('Printing calibration test page...', 'success');
            const result = await ipcRenderer.invoke('print-calibration-page', {
                printer: printerName,
                showDialog: false,
                paperSize,
                paperSource
            });
            if (result.success) {
                showToast('Calibration page sent to printer', 'success');
            } else {
                showToast(`Error: ${result.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const clearCalibration = () => {
        setCalibrationAB('100');
        setCalibrationBC('100');
        setCalibrationCD('100');
        setCalibrationDA('100');
        setBorderTop('');
        setBorderRight('');
        setBorderBottom('');
        setBorderLeft('');
    };

    const isCalibrated = calibrationAB && calibrationBC && calibrationCD && calibrationDA &&
                         parseFloat(calibrationAB) > 0 && parseFloat(calibrationBC) > 0 &&
                         parseFloat(calibrationCD) > 0 && parseFloat(calibrationDA) > 0;

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSave} disabled=${saving}>
            ${saving ? 'Saving...' : 'Save Profile'}
        </button>
    `;

    return html`
        <${Modal}
            isOpen=${isOpen}
            onClose=${onClose}
            title=${profile?.id ? 'Edit Print Profile' : 'Save Print Profile'}
            footer=${footer}
            width="800px"
        >
            <div class="modal-two-column">
                <div class="modal-column-left">
                    <${FormGroup} label="Profile Name" id="profileName">
                        <input
                            type="text"
                            id="profileName"
                            placeholder="e.g., Photo Paper - High Quality"
                            value=${name}
                            onInput=${(e) => setName(e.target.value)}
                        />
                    <//>

                    <${FormRow}>
                        <${FormGroup} label="Copies" id="profileCopies">
                            <input
                                type="number"
                                id="profileCopies"
                                min="1"
                                max="99"
                                value=${copies}
                                onInput=${(e) => setCopies(parseInt(e.target.value) || 1)}
                            />
                        <//>
                        <${FormGroup} label="Paper Size" id="profilePaperSize">
                            <select
                                id="profilePaperSize"
                                value=${paperSize}
                                onChange=${(e) => setPaperSize(e.target.value)}
                            >
                                <option value="letter">Letter (8.5 x 11 in)</option>
                                <option value="legal">Legal (8.5 x 14 in)</option>
                                <option value="A4">A4 (210 x 297 mm)</option>
                                <option value="A5">A5 (148 x 210 mm)</option>
                            </select>
                        <//>
                    <//>

                    <${FormRow}>
                        <${FormGroup} label="Orientation">
                            <div class="orientation-options">
                                <label class="orientation-option">
                                    <input
                                        type="radio"
                                        name="profileOrientation"
                                        value="landscape"
                                        checked=${orientation === 'landscape'}
                                        onChange=${() => setOrientation('landscape')}
                                    />
                                    <span>Landscape</span>
                                </label>
                                <label class="orientation-option">
                                    <input
                                        type="radio"
                                        name="profileOrientation"
                                        value="portrait"
                                        checked=${orientation === 'portrait'}
                                        onChange=${() => setOrientation('portrait')}
                                    />
                                    <span>Portrait</span>
                                </label>
                            </div>
                        <//>
                        <${FormGroup} label="Paper Source" id="profilePaperSource">
                            <select
                                id="profilePaperSource"
                                value=${paperSource}
                                onChange=${(e) => setPaperSource(e.target.value)}
                            >
                                <option value="default">Default</option>
                                <option value="rear">Rear Tray</option>
                            </select>
                        <//>
                    <//>

                    <label class="checkbox-option" style="margin-top: 10px;">
                        <input
                            type="checkbox"
                            checked=${isDefault}
                            onChange=${(e) => setIsDefault(e.target.checked)}
                        />
                        <span>Set as default for this printer</span>
                    </label>
                </div>

                <div class="modal-column-right">
                    <div class="calibration-section" style="margin-top: 0; border: none; padding: 0;">
                        <div class="calibration-header">
                            <h4>Print Calibration</h4>
                            <span class=${`calibration-status ${isCalibrated ? 'calibrated' : 'not-calibrated'}`}>
                                ${isCalibrated ? 'Calibrated' : 'Not Calibrated'}
                            </span>
                        </div>

                        <div class="calibration-diagram">
                            <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
                                <rect x="20" y="20" width="80" height="80" fill="none" stroke="#ccc" stroke-width="1"/>
                                <circle cx="20" cy="20" r="5" fill="#333"/>
                                <circle cx="100" cy="20" r="5" fill="#333"/>
                                <circle cx="100" cy="100" r="5" fill="#333"/>
                                <circle cx="20" cy="100" r="5" fill="#333"/>
                                <text x="15" y="12" font-size="10" fill="#333">A</text>
                                <text x="98" y="12" font-size="10" fill="#333">B</text>
                                <text x="105" y="105" font-size="10" fill="#333">C</text>
                                <text x="8" y="105" font-size="10" fill="#333">D</text>
                            </svg>
                        </div>

                        <button
                            type="button"
                            class="btn btn-secondary"
                            onClick=${handlePrintCalibration}
                            style="width: 100%; margin-bottom: 10px;"
                        >
                            Print Calibration Test Page
                        </button>

                        <p class="calibration-help">
                            Print the test page, measure the distances between dots (in mm), and enter them below.
                            Expected distance: 100mm
                        </p>

                        <div class="calibration-inputs">
                            <div class="calibration-input-group">
                                <label>A-B:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="100"
                                    value=${calibrationAB}
                                    onInput=${(e) => setCalibrationAB(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                            <div class="calibration-input-group">
                                <label>B-C:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="100"
                                    value=${calibrationBC}
                                    onInput=${(e) => setCalibrationBC(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                            <div class="calibration-input-group">
                                <label>C-D:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="100"
                                    value=${calibrationCD}
                                    onInput=${(e) => setCalibrationCD(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                            <div class="calibration-input-group">
                                <label>D-A:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="100"
                                    value=${calibrationDA}
                                    onInput=${(e) => setCalibrationDA(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                        </div>

                        <h5 style="margin-top: 15px; margin-bottom: 8px; font-size: 0.9rem; color: #333;">Border Calibration</h5>
                        <p class="calibration-help" style="margin-top: 0; margin-bottom: 10px;">
                            Measure the white space from paper edge to the black border on each side (in mm).
                        </p>

                        <div class="calibration-inputs">
                            <div class="calibration-input-group">
                                <label>Top:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="0"
                                    value=${borderTop}
                                    onInput=${(e) => setBorderTop(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                            <div class="calibration-input-group">
                                <label>Right:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="0"
                                    value=${borderRight}
                                    onInput=${(e) => setBorderRight(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                            <div class="calibration-input-group">
                                <label>Bottom:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="0"
                                    value=${borderBottom}
                                    onInput=${(e) => setBorderBottom(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                            <div class="calibration-input-group">
                                <label>Left:</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    placeholder="0"
                                    value=${borderLeft}
                                    onInput=${(e) => setBorderLeft(e.target.value)}
                                />
                                <span>mm</span>
                            </div>
                        </div>

                        <button
                            type="button"
                            class="btn btn-secondary"
                            onClick=${clearCalibration}
                            style="width: 100%; margin-top: 10px;"
                        >
                            Clear Calibration
                        </button>
                    </div>
                </div>
            </div>
        <//>
    `;
}

// ============================================================
// Manage Rescues Modal
// ============================================================
function ManageRescuesModal({ isOpen, onClose, onUpdate }) {
    const [rescues, setRescues] = useState([]);
    const [editingRescue, setEditingRescue] = useState(null);

    useEffect(() => {
        if (isOpen) loadRescues();
    }, [isOpen]);

    const loadRescues = () => {
        setRescues(db.getAllRescues());
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Close</button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Manage Rescue Organizations" footer=${footer} width="600px">
            <div class="profile-list">
                ${rescues.length === 0 ? html`
                    <div class="profile-empty">No rescue organizations found. Click "Add New Rescue" to create one.</div>
                ` : rescues.map(rescue => {
                    let logoHtml = null;
                    if (rescue.logo_data) {
                        const mimeType = rescue.logo_mime || 'image/png';
                        const base64 = Buffer.from(rescue.logo_data).toString('base64');
                        logoHtml = html`<img src="data:${mimeType};base64,${base64}" style="width: 40px; height: 40px; object-fit: contain; margin-right: 12px; border-radius: 4px; background: #f5f5f5;" />`;
                    } else {
                        logoHtml = html`<div style="width: 40px; height: 40px; background: #f0f0f0; border-radius: 4px; margin-right: 12px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 0.8rem;">Logo</div>`;
                    }

                    return html`
                        <div key=${rescue.id} class="profile-item" style="display: flex; align-items: center;">
                            ${logoHtml}
                            <div class="profile-item-info" style="flex: 1;">
                                <div class="profile-item-name">${rescue.name}</div>
                                <div class="profile-item-settings">
                                    ${rescue.website || 'No website'}
                                    ${rescue.scraper_type ? ` | Scraper: ${rescue.scraper_type}` : ''}
                                </div>
                            </div>
                            <div class="profile-item-actions">
                                <button class="btn btn-secondary" onClick=${() => setEditingRescue(rescue)}>Edit</button>
                            </div>
                        </div>
                    `;
                })}
            </div>

            <button
                type="button"
                class="btn btn-primary"
                onClick=${() => setEditingRescue({})}
                style="width: 100%; margin-top: 15px;"
            >
                + Add New Rescue
            </button>

            <${EditRescueModal}
                isOpen=${!!editingRescue}
                onClose=${() => setEditingRescue(null)}
                rescue=${editingRescue}
                onSave=${() => { loadRescues(); if (onUpdate) onUpdate(); }}
            />
        <//>
    `;
}

// ============================================================
// Edit Rescue Modal
// ============================================================
function EditRescueModal({ isOpen, onClose, rescue, onSave }) {
    const [name, setName] = useState('');
    const [website, setWebsite] = useState('');
    const [orgId, setOrgId] = useState('');
    const [scraperType, setScraperType] = useState('');
    const [logoData, setLogoData] = useState(null);
    const [logoPreview, setLogoPreview] = useState(null);
    const [saving, setSaving] = useState(false);
    const showToast = useToast();

    useEffect(() => {
        if (!isOpen) return;
        if (rescue?.id) {
            setName(rescue.name || '');
            setWebsite(rescue.website || '');
            setOrgId(rescue.org_id || '');
            setScraperType(rescue.scraper_type || '');
            setLogoData(null);
            if (rescue.logo_data) {
                const mimeType = rescue.logo_mime || 'image/png';
                const base64 = Buffer.from(rescue.logo_data).toString('base64');
                setLogoPreview(`data:${mimeType};base64,${base64}`);
            } else {
                setLogoPreview(null);
            }
        } else {
            setName('');
            setWebsite('');
            setOrgId('');
            setScraperType('');
            setLogoData(null);
            setLogoPreview(null);
        }
    }, [isOpen, rescue]);

    const handleLogoChange = async (imageData) => {
        setLogoData(imageData);
        setLogoPreview(imageData.dataUrl);
    };

    const handleSave = async () => {
        if (!name.trim()) {
            showToast('Please enter a rescue name', 'error');
            return;
        }

        setSaving(true);
        try {
            const rescueData = {
                name: name.trim(),
                website: website || null,
                org_id: orgId || null,
                scraper_type: scraperType || null
            };

            const logoToSave = logoData ? { hex: logoData.hex, mime: logoData.mime, path: logoData.path } : null;

            if (rescue?.id) {
                db.updateRescue(rescue.id, rescueData, logoToSave);
                showToast(`${name} updated successfully!`);
            } else {
                db.createRescue(rescueData, logoToSave);
                showToast(`${name} created successfully!`);
            }

            onClose();
            if (onSave) onSave();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        if (!rescue?.id) return;
        if (!confirm(`Are you sure you want to delete "${rescue.name}"?\n\nThis cannot be undone.`)) return;

        try {
            db.deleteRescue(rescue.id);
            showToast(`${rescue.name} deleted successfully!`);
            onClose();
            if (onSave) onSave();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const footer = html`
        ${rescue?.id && html`
            <button class="btn btn-danger" onClick=${handleDelete}>Delete</button>
        `}
        <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        <button class="btn btn-primary" onClick=${handleSave} disabled=${saving}>
            ${saving ? 'Saving...' : 'Save Rescue'}
        </button>
    `;

    return html`
        <${Modal}
            isOpen=${isOpen}
            onClose=${onClose}
            title=${rescue?.id ? 'Edit Rescue Organization' : 'Add Rescue Organization'}
            footer=${footer}
            width="500px"
        >
            <${ImageUpload}
                imageUrl=${logoPreview}
                onImageChange=${handleLogoChange}
                placeholder="Logo"
            />

            <${FormGroup} label="Name *" id="rescueName">
                <input
                    type="text"
                    id="rescueName"
                    placeholder="e.g., Happy Tails Rescue"
                    value=${name}
                    onInput=${(e) => setName(e.target.value)}
                    required
                />
            <//>

            <${FormGroup} label="Website" id="rescueWebsite">
                <input
                    type="text"
                    id="rescueWebsite"
                    placeholder="e.g., https://example.com"
                    value=${website}
                    onInput=${(e) => setWebsite(e.target.value)}
                />
            <//>

            <${FormRow}>
                <${FormGroup} label="Organization ID" id="rescueOrgId">
                    <input
                        type="text"
                        id="rescueOrgId"
                        placeholder="For scraper (optional)"
                        value=${orgId}
                        onInput=${(e) => setOrgId(e.target.value)}
                    />
                <//>
                <${FormGroup} label="Scraper Type" id="rescueScraperType">
                    <select
                        id="rescueScraperType"
                        value=${scraperType}
                        onChange=${(e) => setScraperType(e.target.value)}
                    >
                        <option value="">None</option>
                        <option value="wagtopia">Wagtopia</option>
                        <option value="adoptapet">Adoptapet</option>
                    </select>
                <//>
            <//>
        <//>
    `;
}

// ============================================================
// Settings Modal (consolidates all "manage" screens)
// ============================================================
function SettingsModal({ isOpen, onClose, printers, onUpdate, onEditTemplate }) {
    const [openaiKey, setOpenaiKey] = useState('');
    const [openaiKeyVisible, setOpenaiKeyVisible] = useState(false);
    const [saving, setSaving] = useState(false);
    const showToast = useToast();

    // Sub-modal states
    const [showManageProfiles, setShowManageProfiles] = useState(false);
    const [showManageRescues, setShowManageRescues] = useState(false);
    const [showManageTemplates, setShowManageTemplates] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadSettings();
        }
    }, [isOpen]);

    const loadSettings = () => {
        try {
            const key = db.getSetting('openai_api_key');
            setOpenaiKey(key || '');
        } catch (err) {
            console.error('[Settings] Error loading settings:', err);
        }
    };

    const handleSaveApiKey = async () => {
        setSaving(true);
        try {
            db.setSetting('openai_api_key', openaiKey);
            showToast('API key saved successfully!');
        } catch (err) {
            showToast(`Error saving API key: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Close</button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Settings" footer=${footer} width="600px">
            <div class="settings-list">
                <div class="settings-list-item" onClick=${() => setShowManageRescues(true)}>
                    <div class="settings-list-item-header">
                        <span class="settings-list-item-icon">🏠</span>
                        <span class="settings-list-item-text">
                            <strong>Rescue Organizations</strong>
                            <small>Add and edit rescue organizations</small>
                        </span>
                        <span class="settings-list-item-arrow">›</span>
                    </div>
                </div>

                <div class="settings-list-item" onClick=${() => setShowManageProfiles(true)}>
                    <div class="settings-list-item-header">
                        <span class="settings-list-item-icon">🖨️</span>
                        <span class="settings-list-item-text">
                            <strong>Print Profiles</strong>
                            <small>Configure printer settings</small>
                        </span>
                        <span class="settings-list-item-arrow">›</span>
                    </div>
                </div>

                <div class="settings-list-item" onClick=${() => setShowManageTemplates(true)}>
                    <div class="settings-list-item-header">
                        <span class="settings-list-item-icon">📄</span>
                        <span class="settings-list-item-text">
                            <strong>Card Templates</strong>
                            <small>Customize card designs</small>
                        </span>
                        <span class="settings-list-item-arrow">›</span>
                    </div>
                </div>

                <div class="settings-list-item settings-list-item-expandable">
                    <div class="settings-list-item-header">
                        <span class="settings-list-item-icon">🤖</span>
                        <span class="settings-list-item-text">
                            <strong>OpenAI API Key</strong>
                            <small>Enable AI-powered bio generation</small>
                        </span>
                    </div>
                    <div class="settings-list-item-content">
                        <div class="api-key-input-container">
                            <input
                                type=${openaiKeyVisible ? 'text' : 'password'}
                                class="api-key-input"
                                placeholder="sk-..."
                                value=${openaiKey}
                                onInput=${(e) => setOpenaiKey(e.target.value)}
                            />
                            <button
                                type="button"
                                class="btn-icon api-key-toggle"
                                onClick=${() => setOpenaiKeyVisible(!openaiKeyVisible)}
                                title=${openaiKeyVisible ? 'Hide API key' : 'Show API key'}
                            >
                                ${openaiKeyVisible ? '🙈' : '👁️'}
                            </button>
                        </div>
                        <div class="api-key-actions">
                            <button
                                class="btn btn-primary btn-sm"
                                onClick=${handleSaveApiKey}
                                disabled=${saving}
                            >
                                ${saving ? 'Saving...' : 'Save'}
                            </button>
                            <a href="#" class="api-key-link" onClick=${(e) => { e.preventDefault(); require('electron').shell.openExternal('https://platform.openai.com/api-keys'); }}>Get an API key</a>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Nested Modals for management screens -->
            <${ManageProfilesModal}
                isOpen=${showManageProfiles}
                onClose=${() => setShowManageProfiles(false)}
                printers=${printers}
                selectedPrinter=${printers.find(p => p.isDefault)?.name || ''}
            />

            <${ManageRescuesModal}
                isOpen=${showManageRescues}
                onClose=${() => setShowManageRescues(false)}
                onUpdate=${onUpdate}
            />

            <${ManageTemplatesModal}
                isOpen=${showManageTemplates}
                onClose=${() => setShowManageTemplates(false)}
                onEditTemplate=${(template) => { setShowManageTemplates(false); onClose(); onEditTemplate(template); }}
            />
        <//>
    `;
}

// ============================================================
// Manage Templates Modal (template list)
// ============================================================
function ManageTemplatesModal({ isOpen, onClose, onEditTemplate }) {
    const [templates, setTemplates] = useState([]);

    useEffect(() => {
        if (isOpen) loadTemplates();
    }, [isOpen]);

    const loadTemplates = () => {
        setTemplates(db.getAllTemplates());
    };

    const footer = html`
        <button class="btn btn-secondary" onClick=${onClose}>Close</button>
    `;

    return html`
        <${Modal} isOpen=${isOpen} onClose=${onClose} title="Manage Card Templates" footer=${footer} width="700px">
            <div class="profile-list">
                ${templates.length === 0 ? html`
                    <div class="profile-empty">No templates found. Click "Add New Template" to create one.</div>
                ` : templates.map(template => {
                    const config = template.config ? JSON.parse(template.config) : {};
                    return html`
                        <div key=${template.id} class="profile-item" style="display: flex; align-items: center;">
                            <div style="width: 40px; height: 40px; background: ${template.is_builtin ? '#e3f2fd' : '#f5f5f5'}; border-radius: 4px; margin-right: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                                ${template.is_builtin ? '📄' : '📝'}
                            </div>
                            <div class="profile-item-info" style="flex: 1;">
                                <div class="profile-item-name">
                                    ${template.name}
                                    ${template.is_builtin ? html`<span style="font-size: 0.75rem; color: #1976d2; margin-left: 8px;">(Built-in)</span>` : ''}
                                </div>
                                <div class="profile-item-settings">
                                    ${template.description || 'No description'}
                                    ${config.pageWidthInches && config.pageHeightInches ? ` | ${config.pageWidthInches}" x ${config.pageHeightInches}"` : ''}
                                </div>
                            </div>
                            <div class="profile-item-actions">
                                <button class="btn btn-secondary" onClick=${() => { onClose(); onEditTemplate(template); }}>
                                    ${template.is_builtin ? 'View' : 'Edit'}
                                </button>
                            </div>
                        </div>
                    `;
                })}
            </div>

            <button
                type="button"
                class="btn btn-primary"
                onClick=${() => { onClose(); onEditTemplate({}); }}
                style="width: 100%; margin-top: 15px;"
            >
                + Add New Template
            </button>
        <//>
    `;
}

// ============================================================
// Sample data for template preview (Atticus)
// ============================================================
// Sample placeholder SVGs for preview when no real image is available
const SAMPLE_PORTRAIT_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#e0e0e0"/><text x="100" y="90" text-anchor="middle" font-family="Arial" font-size="14" fill="#666">Sample</text><text x="100" y="110" text-anchor="middle" font-family="Arial" font-size="14" fill="#666">Portrait</text><circle cx="100" cy="70" r="30" fill="#ccc"/><path d="M60 140 Q100 100 140 140 L140 180 L60 180 Z" fill="#ccc"/></svg>');
const SAMPLE_LOGO_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#667eea"/><text x="50" y="55" text-anchor="middle" font-family="Arial" font-size="12" fill="white">LOGO</text></svg>');
const SAMPLE_SLUG_URL = 'https://www.wagtopia.com/search/pet?id=2553222';

// Generate QR code data URL from a string (async)
async function generateQRCodeDataUrl(text) {
    try {
        return await QRCode.toDataURL(text, {
            width: 200,
            margin: 1,
            color: { dark: '#000000', light: '#ffffff' }
        });
    } catch (err) {
        console.error('[Preview] QR code generation failed:', err);
        return null;
    }
}

const PREVIEW_SAMPLE_DATA = {
    name: 'Atticus',
    breed: 'Boxer Terriers (Medium)',
    ageLong: '3 years',
    ageShort: '3 Yr',
    size: 'Medium',
    gender: 'Neutered(M)',
    shots: '✓',
    housetrained: '✓',
    kids: '✓',
    dogs: '?',
    cats: '?',
    slug: SAMPLE_SLUG_URL,
    portraitPath: 'atticus.jpg',
    portrait: SAMPLE_PORTRAIT_SVG,
    rescueName: 'Paws Rescue League',
    rescueWebsite: 'pawsrescueleague.org',
    rescueLogo: 'logo.png',
    logo: SAMPLE_LOGO_SVG,
    qrcode: null, // Will be generated async
    bio: 'Atticus is a sweet and playful 3-year-old Boxer mix who loves belly rubs and long walks. He gets along great with kids and other dogs, and is working on his leash manners. This handsome boy is looking for his forever home!',
    attributes: ['Leash Trained', 'Crate Trained', 'Loves Belly Rubs', 'Good with Kids', 'Playful', 'Friendly']
};

// Handlebars template rendering for preview
function renderTemplatePreview(templateHtml, data) {
    if (!templateHtml) return '';
    try {
        // Register custom helpers (same as generate-card-cli.js)
        Handlebars.registerHelper('tilde', function(context) {
            return new Handlebars.SafeString('~' + context + '~');
        });

        // Register repeat helper for repeating card content
        Handlebars.registerHelper('repeat', function(count, options) {
            let result = '';
            for (let i = 0; i < count; i++) {
                const frameData = Handlebars.createFrame(options.data);
                frameData.index = i;
                result += options.fn(this, { data: frameData });
            }
            return result;
        });

        const template = Handlebars.compile(templateHtml);
        return template(data);
    } catch (err) {
        console.error('[Preview] Handlebars error:', err.message);
        // Return error message embedded in HTML for visibility
        return `<!DOCTYPE html>
<html><head><style>
body { font-family: Arial, sans-serif; padding: 20px; background: #fff3cd; }
.error { color: #856404; background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; }
.error h3 { margin: 0 0 10px 0; color: #856404; }
.error pre { background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
</style></head><body>
<div class="error">
<h3>Template Error</h3>
<p>${err.message}</p>
</div>
</body></html>`;
    }
}

// ============================================================
// Full-Screen Template Editor
// ============================================================
function TemplateEditorScreen({ template, onClose, onSave, onDuplicate }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [htmlTemplate, setHtmlTemplate] = useState('');
    const [configStr, setConfigStr] = useState('{}');
    const [saving, setSaving] = useState(false);
    const [configError, setConfigError] = useState(null);
    const [previewZoom, setPreviewZoom] = useState(0.5);
    const [previewFullscreen, setPreviewFullscreen] = useState(false);
    const [activeTab, setActiveTab] = useState('html');
    const [previewAnimalId, setPreviewAnimalId] = useState('sample'); // 'sample' for hardcoded Atticus
    const [dbAnimals, setDbAnimals] = useState([]);
    const [dbRescues, setDbRescues] = useState([]);
    const previewRef = useRef(null);
    const fullscreenPreviewRef = useRef(null);
    const showToast = useToast();

    const isBuiltin = !!template?.is_builtin;
    const isNew = !template?.id;

    // Load animals and rescues from database
    useEffect(() => {
        const animals = db.getAllAnimals();
        const rescues = db.getAllRescues();
        setDbAnimals(animals);
        setDbRescues(rescues);
    }, []);

    // Get current preview data based on selected animal (without QR code - that's async)
    const getPreviewData = () => {
        if (previewAnimalId === 'sample') {
            return { ...PREVIEW_SAMPLE_DATA };
        }
        const animal = dbAnimals.find(a => a.id === parseInt(previewAnimalId));
        if (!animal) return { ...PREVIEW_SAMPLE_DATA };

        const rescue = dbRescues.find(r => r.id === animal.rescue_id);

        // Get actual image data URLs from database
        const portraitDataUrl = db.getImageAsDataUrl(animal.id) || SAMPLE_PORTRAIT_SVG;
        const logoDataUrl = rescue ? (db.getRescueLogoAsDataUrl(rescue.id) || SAMPLE_LOGO_SVG) : SAMPLE_LOGO_SVG;

        // Parse attributes JSON if it's a string
        let attributes = [];
        if (animal.attributes) {
            try {
                attributes = typeof animal.attributes === 'string' ? JSON.parse(animal.attributes) : animal.attributes;
            } catch (e) {
                attributes = [];
            }
        }

        return {
            name: animal.name || '',
            breed: animal.breed || '',
            ageLong: animal.age_long || '',
            ageShort: animal.age_short || '',
            size: animal.size || '',
            gender: animal.gender || '',
            shots: animal.shots ? '✓' : '✗',
            housetrained: animal.housetrained ? '✓' : '✗',
            kids: animal.kids === true ? '✓' : (animal.kids === false ? '✗' : '?'),
            dogs: animal.dogs === true ? '✓' : (animal.dogs === false ? '✗' : '?'),
            cats: animal.cats === true ? '✓' : (animal.cats === false ? '✗' : '?'),
            slug: animal.slug || '',
            portraitPath: animal.portrait_path || '',
            portrait: portraitDataUrl,
            rescueName: rescue?.name || '',
            rescueWebsite: rescue?.website || '',
            rescueLogo: rescue?.logo_path || '',
            logo: logoDataUrl,
            qrcode: null, // Will be generated async
            bio: animal.bio || '',
            attributes: attributes
        };
    };

    const previewData = getPreviewData();
    const previewAnimalName = previewAnimalId === 'sample' ? 'Atticus (Sample)' : (dbAnimals.find(a => a.id === parseInt(previewAnimalId))?.name || 'Unknown');

    useEffect(() => {
        if (template?.id) {
            const fullTemplate = db.getTemplateById(template.id);
            setName(fullTemplate?.name || '');
            setDescription(fullTemplate?.description || '');
            setHtmlTemplate(fullTemplate?.html_template || '');
            setConfigStr(fullTemplate?.config ? JSON.stringify(fullTemplate.config, null, 2) : '{}');
        } else {
            setName('');
            setDescription('');
            setHtmlTemplate(getDefaultTemplateHtml());
            setConfigStr(JSON.stringify(getDefaultTemplateConfig(), null, 2));
        }
        setConfigError(null);
    }, [template]);

    // Update preview iframe when template or preview animal changes
    useEffect(() => {
        let cancelled = false;

        const updatePreview = async () => {
            const currentPreviewData = getPreviewData();

            // Generate real QR code from slug
            const slugForQR = currentPreviewData.slug || SAMPLE_SLUG_URL;
            const qrCodeDataUrl = await generateQRCodeDataUrl(slugForQR);
            if (qrCodeDataUrl) {
                currentPreviewData.qrcode = qrCodeDataUrl;
            }

            if (cancelled) return;

            const updateIframe = (iframe) => {
                if (!iframe) return;
                const renderedHtml = renderTemplatePreview(htmlTemplate, currentPreviewData);
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                doc.open();
                doc.write(renderedHtml);
                doc.close();
            };

            updateIframe(previewRef.current);
            if (previewFullscreen) {
                updateIframe(fullscreenPreviewRef.current);
            }
        };

        updatePreview();

        return () => { cancelled = true; };
    }, [htmlTemplate, previewFullscreen, previewAnimalId, dbAnimals, dbRescues]);

    const validateConfig = (str) => {
        try {
            JSON.parse(str);
            setConfigError(null);
            return true;
        } catch (e) {
            setConfigError('Invalid JSON: ' + e.message);
            return false;
        }
    };

    const handleConfigChange = (value) => {
        setConfigStr(value);
        validateConfig(value);
    };

    const handleSave = async () => {
        if (isBuiltin) {
            showToast('Cannot modify built-in templates', 'error');
            return;
        }

        if (!name.trim()) {
            showToast('Please enter a template name', 'error');
            return;
        }

        if (!htmlTemplate.trim()) {
            showToast('Please enter template HTML', 'error');
            return;
        }

        if (!validateConfig(configStr)) {
            showToast('Please fix the JSON configuration errors', 'error');
            return;
        }

        setSaving(true);
        try {
            const templateData = {
                name: name.trim(),
                description: description.trim() || null,
                html_template: htmlTemplate,
                config: JSON.parse(configStr),
                is_builtin: false
            };

            if (template?.id && !isBuiltin) {
                db.updateTemplate(template.id, templateData);
                showToast(`${name} updated successfully!`);
            } else {
                db.createTemplate(templateData);
                showToast(`${name} created successfully!`);
            }

            if (onSave) onSave();
            onClose();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        if (!template?.id || isBuiltin) return;
        if (!confirm(`Are you sure you want to delete "${template.name}"?\n\nThis cannot be undone.`)) return;

        try {
            db.deleteTemplate(template.id);
            showToast(`${template.name} deleted successfully!`);
            if (onSave) onSave();
            onClose();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handleDuplicate = () => {
        if (!template?.id) return;
        const fullTemplate = db.getTemplateById(template.id);

        try {
            // Create a new template in the database
            const templateData = {
                name: (fullTemplate.name || 'Template') + ' (Copy)',
                description: fullTemplate.description || null,
                html_template: fullTemplate.html_template,
                config: fullTemplate.config || {},
                is_builtin: false
            };

            const result = db.createTemplate(templateData);
            const newTemplateId = result.lastInsertRowid;

            // Notify parent to reload templates
            if (onSave) onSave();

            // Get the newly created template and open it for editing
            const newTemplate = db.getTemplateById(newTemplateId);
            showToast(`Template duplicated as "${templateData.name}". Opening for editing.`);

            // Use onDuplicate callback to switch to the new template
            if (onDuplicate) {
                onDuplicate(newTemplate);
            }
        } catch (err) {
            showToast(`Error duplicating template: ${err.message}`, 'error');
        }
    };

    // Fullscreen preview overlay
    if (previewFullscreen) {
        return html`
            <div class="template-editor-fullscreen-preview" onClick=${() => setPreviewFullscreen(false)}>
                <div class="fullscreen-preview-header">
                    <span>Preview: ${name || 'Untitled'} (Sample: Atticus)</span>
                    <div class="fullscreen-preview-controls">
                        <button class="btn btn-secondary" onClick=${(e) => { e.stopPropagation(); setPreviewZoom(z => Math.max(0.25, z - 0.25)); }}>-</button>
                        <span style="min-width: 60px; text-align: center;">${Math.round(previewZoom * 100)}%</span>
                        <button class="btn btn-secondary" onClick=${(e) => { e.stopPropagation(); setPreviewZoom(z => Math.min(2, z + 0.25)); }}>+</button>
                        <button class="btn btn-primary" onClick=${(e) => { e.stopPropagation(); setPreviewFullscreen(false); }} style="margin-left: 20px;">Close</button>
                    </div>
                </div>
                <div class="fullscreen-preview-container" onClick=${(e) => e.stopPropagation()}>
                    <iframe
                        ref=${fullscreenPreviewRef}
                        style="transform: scale(${previewZoom}); transform-origin: top center; width: ${100/previewZoom}%; height: ${100/previewZoom}%; border: none; background: white;"
                        title="Template Preview Fullscreen"
                        sandbox="allow-same-origin"
                    />
                </div>
            </div>
        `;
    }

    // Parse config for preview sizing
    let previewConfig = { pageWidthInches: 11, pageHeightInches: 8.5, orientation: 'landscape' };
    try {
        const parsed = JSON.parse(configStr);
        if (parsed.pageWidthInches) previewConfig.pageWidthInches = parsed.pageWidthInches;
        if (parsed.pageHeightInches) previewConfig.pageHeightInches = parsed.pageHeightInches;
        if (parsed.orientation) previewConfig.orientation = parsed.orientation;
    } catch (e) {}

    // Calculate preview dimensions based on config
    const previewWidth = previewConfig.orientation === 'landscape'
        ? Math.max(previewConfig.pageWidthInches, previewConfig.pageHeightInches)
        : Math.min(previewConfig.pageWidthInches, previewConfig.pageHeightInches);
    const previewHeight = previewConfig.orientation === 'landscape'
        ? Math.min(previewConfig.pageWidthInches, previewConfig.pageHeightInches)
        : Math.max(previewConfig.pageWidthInches, previewConfig.pageHeightInches);

    return html`
        <div class="template-editor-screen">
            <!-- Header with name and description -->
            <div class="template-editor-header">
                <div class="template-editor-title">
                    <button class="btn btn-secondary" onClick=${onClose} style="margin-right: 15px;">
                        ← Back
                    </button>
                    <div class="template-editor-name-desc">
                        <input
                            type="text"
                            class="template-name-input"
                            placeholder=${isNew ? 'Template Name *' : 'Untitled'}
                            value=${name}
                            onInput=${(e) => setName(e.target.value)}
                            disabled=${isBuiltin}
                        />
                        <input
                            type="text"
                            class="template-desc-input"
                            placeholder="Description (optional)"
                            value=${description}
                            onInput=${(e) => setDescription(e.target.value)}
                            disabled=${isBuiltin}
                        />
                    </div>
                    ${isBuiltin && html`<span class="builtin-badge">Built-in (Read Only)</span>`}
                </div>
                <div class="template-editor-actions">
                    ${!isNew && isBuiltin && html`
                        <button class="btn btn-secondary" onClick=${handleDuplicate}>Duplicate as New</button>
                    `}
                    ${!isNew && !isBuiltin && html`
                        <button class="btn btn-danger" onClick=${handleDelete}>Delete</button>
                    `}
                    ${!isBuiltin && html`
                        <button class="btn btn-primary" onClick=${handleSave} disabled=${saving || !!configError}>
                            ${saving ? 'Saving...' : (isNew ? 'Create Template' : 'Save Changes')}
                        </button>
                    `}
                </div>
            </div>

            <!-- Main content -->
            <div class="template-editor-content">
                <!-- Left panel: Editor -->
                <div class="template-editor-left">
                    <!-- Tabs -->
                    <div class="template-editor-tabs">
                        <button
                            class=${`tab-btn ${activeTab === 'html' ? 'active' : ''}`}
                            onClick=${() => setActiveTab('html')}
                        >
                            HTML Template
                        </button>
                        <button
                            class=${`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                            onClick=${() => setActiveTab('config')}
                        >
                            Configuration
                            ${configError && html`<span class="tab-error">!</span>`}
                        </button>
                        <button
                            class=${`tab-btn ${activeTab === 'help' ? 'active' : ''}`}
                            onClick=${() => setActiveTab('help')}
                        >
                            Variables
                        </button>
                    </div>

                    <!-- Tab content -->
                    <div class="template-editor-tab-content">
                        ${activeTab === 'html' && html`
                            <${CodeMirrorEditor}
                                value=${htmlTemplate}
                                onChange=${setHtmlTemplate}
                                language="html"
                                disabled=${isBuiltin}
                                placeholder="<!DOCTYPE html>..."
                            />
                        `}
                        ${activeTab === 'config' && html`
                            <${CodeMirrorEditor}
                                value=${configStr}
                                onChange=${handleConfigChange}
                                language="json"
                                disabled=${isBuiltin}
                                placeholder="{}"
                            />
                            ${configError && html`
                                <div class="config-error">${configError}</div>
                            `}
                        `}
                        ${activeTab === 'help' && html`
                            <div class="variables-help">
                                <h4>Sample Values (${previewAnimalName})</h4>
                                <table class="variables-table">
                                    <thead>
                                        <tr>
                                            <th>Variable</th>
                                            <th>Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${Object.entries(previewData).map(([key, value]) => {
                                            const isImageValue = typeof value === 'string' && value.startsWith('data:image/');
                                            return html`
                                                <tr key=${key}>
                                                    <td><code>{{${key}}}</code></td>
                                                    <td class="variable-value">${
                                                        isImageValue
                                                            ? html`<img src=${value} alt=${key} style="width: 40px; height: 40px; object-fit: contain; border-radius: 4px; background: #f5f5f5;" />`
                                                            : value
                                                    }</td>
                                                </tr>
                                            `;
                                        })}
                                    </tbody>
                                </table>

                                <h4 style="margin-top: 20px;">Configuration Options</h4>
                                <pre>${JSON.stringify({
                                    pageWidthInches: 11,
                                    pageHeightInches: 8.5,
                                    orientation: 'landscape',
                                    paperSize: 'letter',
                                    dpi: 360,
                                    preprocessing: {
                                        generateQrCode: true,
                                        qrCodeSource: 'slug',
                                        convertBooleans: true
                                    }
                                }, null, 2)}</pre>
                            </div>
                        `}
                    </div>
                </div>

                <!-- Right panel: Preview -->
                <div class="template-editor-right">
                    <div class="preview-header">
                        <div class="preview-animal-select">
                            <label>Preview:</label>
                            <select value=${previewAnimalId} onChange=${(e) => setPreviewAnimalId(e.target.value)}>
                                <option value="sample">Atticus (Sample)</option>
                                ${dbAnimals.length > 0 && html`<option disabled>──────────</option>`}
                                ${dbAnimals.map(animal => html`
                                    <option key=${animal.id} value=${animal.id}>${animal.name}</option>
                                `)}
                            </select>
                        </div>
                        <div class="preview-controls">
                            <button class="btn btn-sm" onClick=${() => setPreviewZoom(z => Math.max(0.25, z - 0.1))}>-</button>
                            <span>${Math.round(previewZoom * 100)}%</span>
                            <button class="btn btn-sm" onClick=${() => setPreviewZoom(z => Math.min(1.5, z + 0.1))}>+</button>
                            <button class="btn btn-sm" onClick=${() => setPreviewFullscreen(true)} title="Fullscreen">⛶</button>
                        </div>
                    </div>
                    <div class="preview-container" onClick=${() => setPreviewFullscreen(true)} title="Click for fullscreen">
                        <div class="preview-page-wrapper" style="transform: scale(${previewZoom}); transform-origin: top left;">
                            <iframe
                                ref=${previewRef}
                                style="width: ${previewWidth}in; height: ${previewHeight}in; border: none; background: white; pointer-events: none;"
                                title="Template Preview"
                                sandbox="allow-same-origin"
                            />
                        </div>
                    </div>
                    <div class="preview-info">
                        ${previewWidth}" × ${previewHeight}" (${previewConfig.orientation})
                    </div>
                </div>
            </div>
        </div>
    `;
}

function getDefaultTemplateHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        #page {
            display: grid;
            grid-template-columns: repeat(5, 2in);
            grid-template-rows: repeat(2, 3.5in);
            width: 11in;
            height: 8.5in;
            background: #fff;
        }
        .card {
            width: 2in;
            height: 3.5in;
            padding: 10px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
    </style>
</head>
<body>
    <div id="page">
        <div class="card">
            <h2>{{name}}</h2>
            <p>{{breed}}</p>
            <p>Age: {{ageShort}}</p>
        </div>
    </div>
</body>
</html>`;
}

function getDefaultTemplateConfig() {
    return {
        pageWidthInches: 11,
        pageHeightInches: 8.5,
        orientation: 'landscape',
        paperSize: 'letter',
        dpi: 360,
        preprocessing: {
            generateQrCode: false,
            convertBooleans: true,
            booleanFields: ['shots', 'housetrained'],
            triStateFields: ['kids', 'dogs', 'cats'],
            preparePortrait: true,
            prepareLogo: true
        },
        outputNamePattern: '{name}-custom.png'
    };
}

// ============================================================
// Header Component
// ============================================================
function Header({ subtitle }) {
    return html`
        <header>
            <h1>Foster Animals</h1>
            <p id="subtitle">${subtitle}</p>
        </header>
    `;
}

// ============================================================
// Control Bar Component
// ============================================================
function ControlBar({
    onCreateClick,
    onRefreshClick,
    onDeleteMultipleClick,
    onSettingsClick
}) {
    return html`
        <div class="controls">
            <button onClick=${onCreateClick}>Create Animal</button>
            <button onClick=${onRefreshClick}>Refresh</button>
            <button class="btn-danger-outline" onClick=${onDeleteMultipleClick}>Delete Multiple</button>
            <button class="btn-settings" onClick=${onSettingsClick}>Settings</button>
        </div>
    `;
}

// ============================================================
// Animal Grid Component
// ============================================================
function AnimalGrid({ animals, rescues, onEdit, onPrintFront, onPrintBack, onPrintFlyer, customTemplates, onPrintWithTemplate }) {
    if (animals.length === 0) {
        return html`
            <div class="loading">No animals found. Create one to get started.</div>
        `;
    }

    return html`
        <div class="animals-grid">
            ${animals.map(animal => {
                const rescue = rescues.find(r => r.id === animal.rescue_id);
                return html`
                    <${AnimalCard}
                        key=${animal.id}
                        animal=${animal}
                        rescue=${rescue}
                        onEdit=${onEdit}
                        onPrintFront=${onPrintFront}
                        onPrintBack=${onPrintBack}
                        onPrintFlyer=${onPrintFlyer}
                        customTemplates=${customTemplates}
                        onPrintWithTemplate=${onPrintWithTemplate}
                    />
                `;
            })}
        </div>
    `;
}

// ============================================================
// Main App Component
// ============================================================
function App() {
    // State
    const [animals, setAnimals] = useState([]);
    const [rescues, setRescues] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [subtitle, setSubtitle] = useState('Loading...');

    // Modal states
    const [showCreateOptions, setShowCreateOptions] = useState(false);
    const [showRescueSelect, setShowRescueSelect] = useState(false);
    const [showScrape, setShowScrape] = useState(false);
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [showSelectFromSite, setShowSelectFromSite] = useState(false);
    const [showDeleteMultiple, setShowDeleteMultiple] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [editingTemplateFullscreen, setEditingTemplateFullscreen] = useState(null);
    const [showPrintSettings, setShowPrintSettings] = useState(false);

    // Edit state
    const [editingAnimal, setEditingAnimal] = useState(null);
    const [selectedRescue, setSelectedRescue] = useState('wagtopia');
    const [manualEntryData, setManualEntryData] = useState(null);
    const [printFilePath, setPrintFilePath] = useState(null);
    const [printCallback, setPrintCallback] = useState(null);
    const [printTemplateConfig, setPrintTemplateConfig] = useState(null);

    // Print queue
    const [cardQueue, setCardQueue] = useState([]);
    const [processingQueue, setProcessingQueue] = useState(false);

    // Printers cache
    const [printers, setPrinters] = useState([]);

    // Custom templates for printing
    const [customTemplates, setCustomTemplates] = useState([]);

    const showToast = useToast();

    // Load custom templates function (can be called to refresh)
    const loadTemplates = () => {
        const allTemplates = db.getAllTemplates();
        const custom = allTemplates.filter(t => !t.is_builtin);
        setCustomTemplates(custom);
    };

    // Initialize app
    useEffect(() => {
        (async () => {
            try {
                log('========== Electron app ready ==========');
                const { dbDir, dbPath } = await db.initializeAsync();
                DB_DIR = dbDir;
                DB_PATH = dbPath;
                LOG_DIR = DB_DIR;
                LOG_FILE = path.join(DB_DIR, 'app.log');
                loggingReady = true;
                log('[App] Database initialized at:', DB_PATH);
                await loadAnimals();
                // Load custom templates (non-builtin) for printing
                loadTemplates();
            } catch (err) {
                console.error('[App] Initialization error:', err);
                setError(err.message);
                setLoading(false);
            }
        })();
    }, []);

    // Load printers on mount
    useEffect(() => {
        (async () => {
            try {
                const result = await ipcRenderer.invoke('get-printers');
                if (result.success) setPrinters(result.printers);
            } catch (err) {
                console.error('[App] Error loading printers:', err);
            }
        })();
    }, []);

    // Process print queue
    useEffect(() => {
        if (processingQueue || cardQueue.length === 0) return;

        const processNext = async () => {
            setProcessingQueue(true);
            const task = cardQueue[0];
            const animal = animals.find(a => a.id === task.animalId);

            if (!animal) {
                setCardQueue(prev => prev.slice(1));
                setProcessingQueue(false);
                return;
            }

            try {
                showToast(`Generating cards for ${animal.name}...`);
                await printCard(animal, 'front');
                await printCard(animal, 'back');
                showToast(`Cards generated for ${animal.name}!`);
            } catch (err) {
                console.error('[Queue] Error:', err);
                showToast(`Error generating cards: ${err.message}`, 'error');
            }

            setCardQueue(prev => prev.slice(1));
            setProcessingQueue(false);
        };

        processNext();
    }, [cardQueue, processingQueue, animals]);

    const loadAnimals = async () => {
        setLoading(true);
        try {
            const allRescues = db.getAllRescues();
            setRescues(allRescues);

            const allAnimals = db.getAllAnimals();
            for (const animal of allAnimals) {
                animal.imageDataUrl = db.getImageAsDataUrl(animal.id);
            }
            setAnimals(allAnimals);
            setSubtitle(allAnimals.length > 0
                ? `${allAnimals.length} animals available for adoption`
                : 'No animals in database'
            );
        } catch (err) {
            console.error('[App] Error loading animals:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const printCard = async (animal, side) => {
        const rescue = db.getRescueById(animal.rescue_id || 1);

        // Get image data URLs for templates
        const portraitDataUrl = db.getImageAsDataUrl(animal.id);
        const logoDataUrl = rescue ? db.getRescueLogoAsDataUrl(rescue.id) : null;

        const params = {
            name: animal.name,
            breed: animal.breed,
            ageShort: animal.age_short,
            ageLong: animal.age_long,
            size: animal.size,
            gender: animal.gender,
            shots: animal.shots,
            housetrained: animal.housetrained,
            kids: animal.kids,
            dogs: animal.dogs,
            cats: animal.cats,
            slug: animal.slug,
            portrait: portraitDataUrl || '',
            rescueName: rescue?.name || 'Paws Rescue League',
            rescueWebsite: rescue?.website || 'pawsrescueleague.org',
            logo: logoDataUrl || ''
        };

        const generateFn = side === 'front' ? generateCardFront : generateCardBack;
        const outputPath = await generateFn(params);

        if (process.platform === 'win32') {
            // Get template config for the print dialog
            const templateName = side === 'front' ? 'card-front' : 'card-back';
            let templateConfig = null;
            try {
                const template = db.getTemplateByName(templateName);
                if (template && template.config) {
                    templateConfig = template.config;
                }
            } catch (err) {
                console.log('[App] Could not load template config:', err.message);
            }

            return new Promise((resolve) => {
                setPrintFilePath(outputPath);
                setPrintTemplateConfig(templateConfig);
                setPrintCallback(() => (success) => {
                    setShowPrintSettings(false);
                    setPrintFilePath(null);
                    setPrintTemplateConfig(null);
                    setPrintCallback(null);
                    resolve(success);
                });
                setShowPrintSettings(true);
            });
        } else {
            const result = await ipcRenderer.invoke('open-in-gimp', outputPath);
            if (!result.success) {
                showToast('Could not launch GIMP. Is it installed?', 'error');
            }
        }
    };

    const printFlyer = async (animal) => {
        const rescue = db.getRescueById(animal.rescue_id || 1);

        // Get image data URLs for templates
        const portraitDataUrl = db.getImageAsDataUrl(animal.id);
        const logoDataUrl = rescue ? db.getRescueLogoAsDataUrl(rescue.id) : null;

        // Get stored attributes, or build from animal data as fallback
        let traits = db.getAnimalAttributes(animal.id);
        if (!traits || traits.length === 0) {
            // Fallback: build traits list from animal data for the flyer template
            traits = [];
            if (animal.breed) traits.push(animal.breed);
            if (animal.age_long) traits.push(animal.age_long);
            if (animal.size) traits.push(animal.size);
            if (animal.gender) traits.push(animal.gender);
            if (animal.shots) traits.push('Up to date on shots');
            if (animal.housetrained) traits.push('Housetrained');
            if (animal.kids === 1) traits.push('Good with kids');
            if (animal.dogs === 1) traits.push('Good with dogs');
            if (animal.cats === 1) traits.push('Good with cats');
        }

        const params = {
            name: animal.name,
            breed: animal.breed,
            ageShort: animal.age_short,
            ageLong: animal.age_long,
            size: animal.size,
            gender: animal.gender,
            shots: animal.shots,
            housetrained: animal.housetrained,
            kids: animal.kids,
            dogs: animal.dogs,
            cats: animal.cats,
            slug: animal.slug,
            portrait: portraitDataUrl || '',
            rescueName: rescue?.name || 'Paws Rescue League',
            rescueWebsite: rescue?.website || 'pawsrescueleague.org',
            logo: logoDataUrl || '',
            // Add trait fields for the flyer template (up to 16)
            trait1: traits[0] || '',
            trait2: traits[1] || '',
            trait3: traits[2] || '',
            trait4: traits[3] || '',
            trait5: traits[4] || '',
            trait6: traits[5] || '',
            trait7: traits[6] || '',
            trait8: traits[7] || '',
            trait9: traits[8] || '',
            trait10: traits[9] || '',
            trait11: traits[10] || '',
            trait12: traits[11] || '',
            trait13: traits[12] || '',
            trait14: traits[13] || '',
            trait15: traits[14] || '',
            trait16: traits[15] || ''
        };

        // Get the adoption-flyer template from database
        const template = db.getTemplateByName('adoption-flyer');
        if (!template) {
            throw new Error('Adoption flyer template not found. Please check your templates.');
        }

        const outputPath = await generateFromTemplate(template, params);

        if (process.platform === 'win32') {
            // Get template config for the print dialog
            let templateConfig = null;
            try {
                if (template && template.config) {
                    templateConfig = typeof template.config === 'string'
                        ? JSON.parse(template.config)
                        : template.config;
                }
            } catch (err) {
                console.log('[App] Could not load template config:', err.message);
            }

            return new Promise((resolve) => {
                setPrintFilePath(outputPath);
                setPrintTemplateConfig(templateConfig);
                setPrintCallback(() => (success) => {
                    setShowPrintSettings(false);
                    setPrintFilePath(null);
                    setPrintTemplateConfig(null);
                    setPrintCallback(null);
                    resolve(success);
                });
                setShowPrintSettings(true);
            });
        } else {
            const result = await ipcRenderer.invoke('open-in-gimp', outputPath);
            if (!result.success) {
                showToast('Could not launch GIMP. Is it installed?', 'error');
            }
        }
    };

    const handleScrape = async (url) => {
        try {
            showToast('Scraping data from URL...');
            const ipcChannel = selectedRescue === 'adoptapet'
                ? 'scrape-animal-page-adoptapet'
                : 'scrape-animal-page-wagtopia';

            const result = await ipcRenderer.invoke(ipcChannel, url);
            if (!result.success) throw new Error(result.error);

            const scrapedData = result.data;
            let imageData = null;

            if (scrapedData.imagePath) {
                try {
                    const imagePath = path.isAbsolute(scrapedData.imagePath)
                        ? scrapedData.imagePath
                        : path.join(APP_PATH, scrapedData.imagePath);
                    const buffer = fs.readFileSync(imagePath);
                    imageData = bufferToImageData(buffer, imagePath);
                    fs.unlinkSync(imagePath);
                } catch (imgErr) {
                    console.error('Error loading scraped image:', imgErr);
                }
            }

            setManualEntryData({
                ...scrapedData,
                imageDataUrl: imageData?.dataUrl || null,
                imageData
            });
            setShowScrape(false);
            setShowManualEntry(true);
            showToast('Data scraped successfully!');
        } catch (err) {
            showToast(`Error scraping URL: ${err.message}`, 'error');
        }
    };

    const handlePrintFront = async (animalId) => {
        const animal = animals.find(a => a.id === animalId);
        if (!animal) return;
        try {
            showToast(`Generating card front for ${animal.name}...`);
            await printCard(animal, 'front');
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handlePrintBack = async (animalId) => {
        const animal = animals.find(a => a.id === animalId);
        if (!animal) return;
        try {
            showToast(`Generating card back for ${animal.name}...`);
            await printCard(animal, 'back');
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handlePrintFlyer = async (animalId) => {
        const animal = animals.find(a => a.id === animalId);
        if (!animal) return;
        try {
            showToast(`Generating adoption flyer for ${animal.name}...`);
            await printFlyer(animal);
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handlePrintWithTemplate = async (animalId, templateId) => {
        const animal = animals.find(a => a.id === animalId);
        if (!animal) return;

        const template = db.getTemplateById(templateId);
        if (!template) {
            showToast('Template not found', 'error');
            return;
        }

        try {
            showToast(`Generating ${template.name} for ${animal.name}...`);

            const rescue = db.getRescueById(animal.rescue_id || 1);
            const portraitDataUrl = db.getImageAsDataUrl(animal.id);
            const logoDataUrl = rescue ? db.getRescueLogoAsDataUrl(rescue.id) : null;

            // Get stored attributes, or build from animal data as fallback
            let traits = db.getAnimalAttributes(animal.id);
            if (!traits || traits.length === 0) {
                traits = [];
                if (animal.breed) traits.push(animal.breed);
                if (animal.age_long) traits.push(animal.age_long);
                if (animal.size) traits.push(animal.size);
                if (animal.gender) traits.push(animal.gender);
                if (animal.shots) traits.push('Up to date on shots');
                if (animal.housetrained) traits.push('Housetrained');
                if (animal.kids === 1) traits.push('Good with kids');
                if (animal.dogs === 1) traits.push('Good with dogs');
                if (animal.cats === 1) traits.push('Good with cats');
            }

            const params = {
                name: animal.name,
                breed: animal.breed,
                ageShort: animal.age_short,
                ageLong: animal.age_long,
                size: animal.size,
                gender: animal.gender,
                shots: animal.shots,
                housetrained: animal.housetrained,
                kids: animal.kids,
                dogs: animal.dogs,
                cats: animal.cats,
                slug: animal.slug,
                bio: animal.bio || '',
                portrait: portraitDataUrl || '',
                rescueName: rescue?.name || 'Paws Rescue League',
                rescueWebsite: rescue?.website || 'pawsrescueleague.org',
                logo: logoDataUrl || '',
                // Add trait fields (up to 16)
                trait1: traits[0] || '',
                trait2: traits[1] || '',
                trait3: traits[2] || '',
                trait4: traits[3] || '',
                trait5: traits[4] || '',
                trait6: traits[5] || '',
                trait7: traits[6] || '',
                trait8: traits[7] || '',
                trait9: traits[8] || '',
                trait10: traits[9] || '',
                trait11: traits[10] || '',
                trait12: traits[11] || '',
                trait13: traits[12] || '',
                trait14: traits[13] || '',
                trait15: traits[14] || '',
                trait16: traits[15] || ''
            };

            const outputPath = await generateFromTemplate(template, params);

            if (process.platform === 'win32') {
                let templateConfig = null;
                try {
                    if (template.config) {
                        templateConfig = typeof template.config === 'string'
                            ? JSON.parse(template.config)
                            : template.config;
                    }
                } catch (err) {
                    console.log('[App] Could not load template config:', err.message);
                }

                return new Promise((resolve) => {
                    setPrintFilePath(outputPath);
                    setPrintTemplateConfig(templateConfig);
                    setPrintCallback(() => (success) => {
                        setShowPrintSettings(false);
                        setPrintFilePath(null);
                        setPrintTemplateConfig(null);
                        setPrintCallback(null);
                        resolve(success);
                    });
                    setShowPrintSettings(true);
                });
            } else {
                const result = await ipcRenderer.invoke('open-in-gimp', outputPath);
                if (!result.success) {
                    showToast('Could not launch GIMP. Is it installed?', 'error');
                }
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    if (error) {
        return html`
            <div class="container">
                <${Header} subtitle="Error" />
                <div class="error">
                    <h3>Error</h3>
                    <p>${error}</p>
                </div>
            </div>
        `;
    }

    // Show full-screen template editor if editing a template
    if (editingTemplateFullscreen !== null) {
        return html`
            <${TemplateEditorScreen}
                template=${editingTemplateFullscreen}
onClose=${() => {
                    setEditingTemplateFullscreen(null);
                    setShowSettings(true);
                }}
                onSave=${() => {
                    loadTemplates();
                }}
                onDuplicate=${(newTemplate) => {
                    loadTemplates();
                    setEditingTemplateFullscreen(newTemplate);
                }}
            />
        `;
    }

    return html`
        <div class="container">
            <${Header} subtitle=${subtitle} />

            <${ControlBar}
                onCreateClick=${() => setShowCreateOptions(true)}
                onRefreshClick=${loadAnimals}
                onDeleteMultipleClick=${() => setShowDeleteMultiple(true)}
                onSettingsClick=${() => setShowSettings(true)}
            />

            <div id="content">
                ${loading
                    ? html`<div class="loading">Loading animals...</div>`
                    : html`
                        <${AnimalGrid}
                            animals=${animals}
                            rescues=${rescues}
                            onEdit=${(id) => setEditingAnimal(animals.find(a => a.id === id))}
                            onPrintFront=${handlePrintFront}
                            onPrintBack=${handlePrintBack}
                            onPrintFlyer=${handlePrintFlyer}
                            customTemplates=${customTemplates}
                            onPrintWithTemplate=${handlePrintWithTemplate}
                        />
                    `
                }
            </div>

            <!-- Modals -->
            <${CreateOptionsModal}
                isOpen=${showCreateOptions}
                onClose=${() => setShowCreateOptions(false)}
                onSelectManual=${() => { setShowCreateOptions(false); setManualEntryData(null); setShowManualEntry(true); }}
                onSelectScrape=${() => { setShowCreateOptions(false); setShowScrape(true); }}
                onSelectFromSite=${() => { setShowCreateOptions(false); setShowRescueSelect(true); }}
            />

            <${RescueSelectModal}
                isOpen=${showRescueSelect}
                onClose=${() => setShowRescueSelect(false)}
                onSelect=${(rescue) => { setSelectedRescue(rescue); setShowRescueSelect(false); setShowSelectFromSite(true); }}
            />

            <${ScrapeModal}
                isOpen=${showScrape}
                onClose=${() => setShowScrape(false)}
                onScrape=${handleScrape}
            />

            <${ManualEntryModal}
                isOpen=${showManualEntry}
                onClose=${() => { setShowManualEntry(false); setManualEntryData(null); }}
                rescues=${rescues}
                initialData=${manualEntryData}
                onSubmit=${loadAnimals}
            />

            <${EditAnimalModal}
                isOpen=${!!editingAnimal}
                onClose=${() => setEditingAnimal(null)}
                animal=${editingAnimal}
                rescues=${rescues}
                onSubmit=${loadAnimals}
                onDelete=${loadAnimals}
            />

            <${SelectFromSiteModal}
                isOpen=${showSelectFromSite}
                onClose=${() => setShowSelectFromSite(false)}
                selectedRescue=${selectedRescue}
                onImportComplete=${loadAnimals}
            />

            <${DeleteMultipleModal}
                isOpen=${showDeleteMultiple}
                onClose=${() => setShowDeleteMultiple(false)}
                animals=${animals}
                onDeleteComplete=${loadAnimals}
            />

            <${SettingsModal}
                isOpen=${showSettings}
                onClose=${() => setShowSettings(false)}
                printers=${printers}
                onUpdate=${loadAnimals}
                onEditTemplate=${(template) => setEditingTemplateFullscreen(template)}
            />

            <${PrintSettingsModal}
                isOpen=${showPrintSettings}
                onClose=${() => { setShowPrintSettings(false); setPrintTemplateConfig(null); if (printCallback) printCallback(false); }}
                filePath=${printFilePath}
                onPrintComplete=${printCallback}
                templateConfig=${printTemplateConfig}
            />
        </div>
    `;
}

// ============================================================
// Root Component with Providers
// ============================================================
function Root() {
    return html`
        <${ToastProvider}>
            <${App} />
        <//>
    `;
}

// ============================================================
// Initialize Application
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('app') || document.body;
    render(html`<${Root} />`, container);
});
