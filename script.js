(function() {
  'use strict';
  
  // ============================================================================
  // CONSTANTS
  // ============================================================================
  
  const STORAGE_KEY = 'promptLibrary.items.v1';
  const NOTES_KEY = 'promptNotes.v1';
  const META_VERSION = 'v1';
  const EXPORT_FILE_BASENAME = 'prompt-library-backup';
  const EXPORT_SCHEMA_VERSION = 1;
  const MAX_STARS = 5;

  // ============================================================================
  // DOM REFERENCES
  // ============================================================================
  
  const form = document.getElementById('prompt-form');
  const titleInput = document.getElementById('prompt-title');
  const contentInput = document.getElementById('prompt-content');
  const modelInput = document.getElementById('model-name');
  const editIdInput = document.getElementById('edit-id');
  const errorEl = document.getElementById('form-error');
  const listEl = document.getElementById('prompts-list');
  const emptyEl = document.getElementById('prompts-empty');
  const cardTemplate = document.getElementById('prompt-card-template');
  const formModeLabel = document.getElementById('form-mode-label');
  const saveBtnText = document.getElementById('save-btn-text');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const clearBtn = document.getElementById('clear-btn');
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const sortSelect = document.getElementById('sort-select');

  // ============================================================================
  // STATE
  // ============================================================================
  
  let currentPrompts = [];
  let currentSearchTerm = '';
  let currentSortBy = 'date-desc';
  let isEditMode = false;

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  
  function trim(str) { 
    return (str || '').trim(); 
  }

  function createId() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function preview(text, wordCount = 16) {
    const words = trim(text).split(/\s+/).slice(0, wordCount);
    return words.join(' ');
  }

  function formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Unknown';
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // STORAGE FUNCTIONS
  // ============================================================================
  
  function loadPrompts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data
        .filter(p => p && typeof p.id === 'string')
        .map(p => hydrateLegacyPrompt(p))
        .sort((a,b) => new Date(b.metadata?.createdAt || 0) - new Date(a.metadata?.createdAt || 0));
    } catch (e) {
      console.warn('Failed to parse stored prompts', e);
      return [];
    }
  }

  function savePrompts(prompts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
      currentPrompts = prompts;
    } catch (e) {
      console.error('Failed to save prompts', e);
      showError('Failed to save. Storage may be full.');
    }
  }

  function hydrateLegacyPrompt(p) {
    if (p && p.metadata && typeof p.metadata === 'object' && p.metadata.model && p.metadata.createdAt) {
      if (!('userRating' in p)) p.userRating = null;
      return p;
    }
    try {
      const model = typeof p.model === 'string' ? p.model : 'unknown-model';
      const meta = trackModel(model, p.content || '');
      p.metadata = meta;
      p.userRating = p.userRating || null;
      return p;
    } catch {
      p.metadata = {
        model: 'unknown',
        createdAt: new Date(p.createdAt || Date.now()).toISOString(),
        updatedAt: new Date(p.createdAt || Date.now()).toISOString(),
        tokenEstimate: estimateTokens(p.content || '', true)
      };
      p.userRating = null;
      return p;
    }
  }

  // ============================================================================
  // TOKEN ESTIMATION
  // ============================================================================
  
  function estimateTokens(text, detailed = true) {
    if (!text || typeof text !== 'string') {
      return detailed ? { min: 0, max: 0, avg: 0, confidence: 'low' } : 0;
    }
    const chars = text.length;
    const words = text.split(/\s+/).filter(w => w.length > 0).length;
    const avgTokenPerWord = 1.3;
    const avgTokenPerChar = 0.25;
    const wordEst = Math.ceil(words * avgTokenPerWord);
    const charEst = Math.ceil(chars * avgTokenPerChar);
    const avg = Math.ceil((wordEst + charEst) / 2);
    const min = Math.floor(avg * 0.85);
    const max = Math.ceil(avg * 1.15);
    
    let confidence = 'medium';
    if (words > 100) confidence = 'high';
    else if (words < 20) confidence = 'low';
    
    return detailed ? { min, max, avg, confidence } : avg;
  }

  function trackModel(modelName, content) {
    const now = new Date().toISOString();
    return {
      model: modelName,
      createdAt: now,
      updatedAt: now,
      tokenEstimate: estimateTokens(content, true)
    };
  }

  // ============================================================================
  // FORM HANDLING
  // ============================================================================
  
  function showError(message) {
    errorEl.textContent = message;
    setTimeout(() => errorEl.textContent = '', 5000);
  }

  function clearForm() {
    form.reset();
    editIdInput.value = '';
    errorEl.textContent = '';
    isEditMode = false;
    formModeLabel.textContent = 'ADD A PROMPT';
    saveBtnText.textContent = 'SAVE PROMPT';
    cancelEditBtn.hidden = true;
  }

  function validateForm() {
    const title = trim(titleInput.value);
    const content = trim(contentInput.value);
    const model = trim(modelInput.value);

    if (!title) {
      showError('Title is required');
      titleInput.focus();
      return false;
    }
    if (!model) {
      showError('Model is required');
      modelInput.focus();
      return false;
    }
    if (!content) {
      showError('Content is required');
      contentInput.focus();
      return false;
    }
    return true;
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    
    if (!validateForm()) return;

    const title = trim(titleInput.value);
    const content = trim(contentInput.value);
    const model = trim(modelInput.value);
    const editId = trim(editIdInput.value);

    const prompts = loadPrompts();

    if (editId) {
      const index = prompts.findIndex(p => p.id === editId);
      if (index !== -1) {
        prompts[index] = {
          ...prompts[index],
          title,
          content,
          metadata: {
            ...prompts[index].metadata,
            model,
            updatedAt: new Date().toISOString(),
            tokenEstimate: estimateTokens(content, true)
          }
        };
      }
    } else {
      const newPrompt = {
        id: createId(),
        title,
        content,
        userRating: null,
        metadata: trackModel(model, content)
      };
      prompts.unshift(newPrompt);
    }

    savePrompts(prompts);
    clearForm();
    applyFiltersAndRender();
    
    if (listEl.firstElementChild) {
      listEl.firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function deletePrompt(id) {
    // No confirmation - just delete
    const prompts = loadPrompts().filter(p => p.id !== id);
    savePrompts(prompts);
    
    const notesStore = loadNotesStore();
    if (notesStore[id]) {
      delete notesStore[id];
      saveNotesStore(notesStore);
    }
    
    applyFiltersAndRender();
    showIEMessage('Prompt deleted', 'success');
  }

  // ============================================================================
  // COPY TO CLIPBOARD
  // ============================================================================
  
  async function copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      
      button.classList.add('copied');
      const originalHTML = button.innerHTML;
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 4L6 11L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      
      setTimeout(() => {
        button.classList.remove('copied');
        button.innerHTML = originalHTML;
      }, 1500);
      
      showIEMessage('Copied to clipboard!', 'success');
    } catch (err) {
      console.error('Failed to copy:', err);
      showIEMessage('Failed to copy', 'error');
    }
  }

  // ============================================================================
  // SEARCH & FILTER
  // ============================================================================
  
  function filterPrompts(prompts, searchTerm) {
    if (!searchTerm) return prompts;
    
    const term = searchTerm.toLowerCase();
    return prompts.filter(p => {
      const titleMatch = (p.title || '').toLowerCase().includes(term);
      const contentMatch = (p.content || '').toLowerCase().includes(term);
      const modelMatch = (p.metadata?.model || '').toLowerCase().includes(term);
      return titleMatch || contentMatch || modelMatch;
    });
  }

  function sortPrompts(prompts, sortBy) {
    const sorted = [...prompts];
    
    switch(sortBy) {
      case 'date-desc':
        return sorted.sort((a, b) => 
          new Date(b.metadata?.createdAt || 0) - new Date(a.metadata?.createdAt || 0)
        );
      case 'date-asc':
        return sorted.sort((a, b) => 
          new Date(a.metadata?.createdAt || 0) - new Date(b.metadata?.createdAt || 0)
        );
      case 'title-asc':
        return sorted.sort((a, b) => 
          (a.title || '').localeCompare(b.title || '')
        );
      case 'title-desc':
        return sorted.sort((a, b) => 
          (b.title || '').localeCompare(a.title || '')
        );
      case 'rating-desc':
        return sorted.sort((a, b) => {
          const ratingA = a.userRating || 0;
          const ratingB = b.userRating || 0;
          if (ratingB !== ratingA) return ratingB - ratingA;
          return new Date(b.metadata?.createdAt || 0) - new Date(a.metadata?.createdAt || 0);
        });
      default:
        return sorted;
    }
  }

  function applyFiltersAndRender() {
    let prompts = loadPrompts();
    prompts = filterPrompts(prompts, currentSearchTerm);
    prompts = sortPrompts(prompts, currentSortBy);
    render(prompts);
  }

  function handleSearch(e) {
    currentSearchTerm = trim(e.target.value);
    clearSearchBtn.hidden = !currentSearchTerm;
    applyFiltersAndRender();
  }

  function clearSearch() {
    searchInput.value = '';
    currentSearchTerm = '';
    clearSearchBtn.hidden = true;
    applyFiltersAndRender();
  }

  function handleSortChange(e) {
    currentSortBy = e.target.value;
    applyFiltersAndRender();
  }

  // ============================================================================
  // RATING SYSTEM - FIXED
  // ============================================================================
  
  function normalizeRating(val) {
    if (val == null) return null;
    const n = Number(val);
    return n >= 1 && n <= MAX_STARS ? n : null;
  }

  function setRating(promptId, value) {
    console.log('setRating called:', promptId, value);
    const prompts = loadPrompts();
    const prompt = prompts.find(p => p.id === promptId);
    if (!prompt) {
      console.warn('Prompt not found:', promptId);
      return;
    }
    
    const current = normalizeRating(prompt.userRating);
    const next = normalizeRating(value);
    
    // Toggle off if clicking the same star, otherwise set the new rating
    if (current === next) {
      prompt.userRating = null;
    } else {
      prompt.userRating = next;
    }
    
    console.log('Updating rating from', current, 'to', prompt.userRating);
    savePrompts(prompts);
    updateCardRatingUI(promptId, prompt.userRating);
  }

  function buildRatingElement(prompt) {
    if (!('userRating' in prompt)) prompt.userRating = null;
    
    const wrap = document.createElement('div');
    wrap.className = 'rating';
    wrap.dataset.promptId = prompt.id;
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', `Rate ${prompt.title}`);
    
    for (let i = 1; i <= MAX_STARS; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'star' + (prompt.userRating && prompt.userRating >= i ? ' filled' : '');
      btn.dataset.value = String(i);
      btn.dataset.promptId = prompt.id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(prompt.userRating === i));
      btn.setAttribute('aria-label', `${i} star${i>1?'s':''}`);
      btn.textContent = (prompt.userRating && prompt.userRating >= i) ? '★' : '☆';
      
      // Hover preview
      btn.addEventListener('mouseenter', () => previewHover(wrap, i));
      btn.addEventListener('mouseleave', () => clearHover(wrap, prompt.userRating));
      
      wrap.appendChild(btn);
    }
    
    return wrap;
  }

  function updateCardRatingUI(promptId, rating) {
    const card = listEl.querySelector(`[data-id="${promptId}"]`);
    if (!card) return;
    const wrap = card.querySelector('.rating');
    if (!wrap) return;
    
    [...wrap.querySelectorAll('button.star')].forEach(btn => {
      const val = Number(btn.dataset.value);
      const filled = rating != null && rating >= val;
      btn.classList.toggle('filled', filled);
      btn.textContent = filled ? '★' : '☆';
      btn.setAttribute('aria-checked', String(rating === val));
    });
  }

  function handleStarKey(e, promptId) {
    const key = e.key;
    const target = e.currentTarget;
    if (!target || !target.dataset.value) return;
    const currentVal = Number(target.dataset.value);
    
    if (['ArrowRight','ArrowUp'].includes(key)) {
      e.preventDefault();
      const next = Math.min(MAX_STARS, currentVal + 1);
      setRating(promptId, next);
      focusStar(promptId, next);
    } else if (['ArrowLeft','ArrowDown'].includes(key)) {
      e.preventDefault();
      const prev = Math.max(1, currentVal - 1);
      setRating(promptId, prev);
      focusStar(promptId, prev);
    } else if (key === 'Home') {
      e.preventDefault();
      setRating(promptId, 1);
      focusStar(promptId, 1);
    } else if (key === 'End') {
      e.preventDefault();
      setRating(promptId, MAX_STARS);
      focusStar(promptId, MAX_STARS);
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      setRating(promptId, currentVal);
    }
  }

  function focusStar(promptId, value) {
    const card = listEl.querySelector(`[data-id="${promptId}"]`);
    if (!card) return;
    const btn = card.querySelector(`.star[data-value="${value}"]`);
    if (btn) btn.focus();
  }

  function previewHover(wrap, value) {
    [...wrap.querySelectorAll('button.star')].forEach(btn => {
      const val = Number(btn.dataset.value);
      const shouldFill = val <= value;
      btn.classList.toggle('filled', shouldFill);
      btn.textContent = shouldFill ? '★' : '☆';
    });
  }

  function clearHover(wrap, currentRating) {
    [...wrap.querySelectorAll('button.star')].forEach(btn => {
      const val = Number(btn.dataset.value);
      const filled = currentRating != null && currentRating >= val;
      btn.classList.toggle('filled', filled);
      btn.textContent = filled ? '★' : '☆';
    });
  }

  // ============================================================================
  // METADATA DISPLAY
  // ============================================================================
  
  function buildMetadataDisplay(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return document.createTextNode('No metadata');
    }
    
    const frag = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'prompt-meta-row';
    
    if (metadata.model) {
      const modelSpan = document.createElement('span');
      modelSpan.className = 'prompt-meta-tag';
      modelSpan.innerHTML = `<span class="model-name">${escapeHtml(metadata.model)}</span>`;
      row.appendChild(modelSpan);
    }
    
    const tokenEst = metadata.tokenEstimate;
    if (tokenEst && typeof tokenEst === 'object') {
      const tokenSpan = document.createElement('span');
      tokenSpan.className = 'token-estimate';
      tokenSpan.dataset.confidence = tokenEst.confidence || 'medium';
      tokenSpan.innerHTML = `<span class="token-range">${tokenEst.min}-${tokenEst.max}</span>`;
      row.appendChild(tokenSpan);
    }
    
    if (metadata.createdAt) {
      const timeTag = document.createElement('time');
      timeTag.dateTime = metadata.createdAt;
      timeTag.textContent = formatDate(metadata.createdAt);
      row.appendChild(timeTag);
    }
    
    frag.appendChild(row);
    return frag;
  }

  // ============================================================================
  // NOTES SYSTEM
  // ============================================================================
  
  function loadNotesStore() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  function saveNotesStore(store) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(store));
    } catch (e) {
      console.error('Failed to save notes', e);
    }
  }

  function buildNotesSection(promptId) {
    const section = document.createElement('div');
    section.className = 'notes';
    
    const header = document.createElement('div');
    header.className = 'notes-header';
    
    const title = document.createElement('h4');
    title.className = 'notes-title';
    title.textContent = 'Notes';
    
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-note-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => addNote(promptId));
    
    header.appendChild(title);
    header.appendChild(addBtn);
    section.appendChild(header);
    
    const list = document.createElement('ul');
    list.className = 'notes-list';
    list.dataset.promptId = promptId;
    
    const notes = loadNotesStore()[promptId] || [];
    notes.forEach(note => {
      list.appendChild(buildNoteElement(note, promptId));
    });
    
    section.appendChild(list);
    return section;
  }

  function buildNoteElement(note, promptId) {
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.noteId = note.id;
    
    const content = document.createElement('p');
    content.className = 'note-content';
    content.textContent = note.text;
    
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    
    const time = document.createElement('time');
    time.dateTime = note.createdAt;
    time.textContent = formatDate(note.createdAt);
    
    const buttons = document.createElement('div');
    buttons.className = 'note-buttons';
    
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.dataset.action = 'edit-note';
    editBtn.addEventListener('click', () => editNote(promptId, note.id, li));
    
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.dataset.action = 'delete-note';
    deleteBtn.addEventListener('click', () => deleteNote(promptId, note.id));
    
    buttons.appendChild(editBtn);
    buttons.appendChild(deleteBtn);
    meta.appendChild(time);
    meta.appendChild(buttons);
    
    li.appendChild(content);
    li.appendChild(meta);
    
    return li;
  }

  function addNote(promptId) {
    const notesStore = loadNotesStore();
    if (!Array.isArray(notesStore[promptId])) {
      notesStore[promptId] = [];
    }
    
    const newNote = {
      id: createId(),
      text: '',
      createdAt: new Date().toISOString()
    };
    
    notesStore[promptId].push(newNote);
    saveNotesStore(notesStore);
    
    const list = document.querySelector(`.notes-list[data-prompt-id="${promptId}"]`);
    if (list) {
      const noteEl = buildNoteElement(newNote, promptId);
      list.appendChild(noteEl);
      editNote(promptId, newNote.id, noteEl);
    }
  }

  function editNote(promptId, noteId, noteEl) {
    const notesStore = loadNotesStore();
    const notes = notesStore[promptId] || [];
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    
    noteEl.classList.add('editing');
    
    const textarea = document.createElement('textarea');
    textarea.value = note.text;
    textarea.placeholder = 'Enter note...';
    
    const controls = document.createElement('div');
    controls.className = 'note-controls';
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    
    const validation = document.createElement('div');
    validation.className = 'note-validation';
    
    const save = () => {
      const text = trim(textarea.value);
      if (!text) {
        validation.textContent = 'Note cannot be empty';
        return;
      }
      
      note.text = text;
      note.updatedAt = new Date().toISOString();
      saveNotesStore(notesStore);
      
      const newNoteEl = buildNoteElement(note, promptId);
      noteEl.replaceWith(newNoteEl);
    };
    
    const cancel = () => {
      if (!note.text) {
        deleteNote(promptId, noteId);
      } else {
        const newNoteEl = buildNoteElement(note, promptId);
        noteEl.replaceWith(newNoteEl);
      }
    };
    
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', cancel);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
    });
    
    controls.appendChild(saveBtn);
    controls.appendChild(cancelBtn);
    
    noteEl.innerHTML = '';
    noteEl.appendChild(textarea);
    noteEl.appendChild(controls);
    noteEl.appendChild(validation);
    
    textarea.focus();
  }

  function deleteNote(promptId, noteId) {
    // No confirmation - just delete
    const notesStore = loadNotesStore();
    const notes = notesStore[promptId] || [];
    notesStore[promptId] = notes.filter(n => n.id !== noteId);
    saveNotesStore(notesStore);
    
    const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
    if (noteEl) noteEl.remove();
  }

  // ============================================================================
  // RENDERING
  // ============================================================================
  
  function render(prompts) {
    listEl.innerHTML = '';

    if (!prompts.length) {
      emptyEl.hidden = false;
      return;
    }
    
    emptyEl.hidden = true;

    const frag = document.createDocumentFragment();
    
    prompts.forEach(p => {
      const node = cardTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = p.id;
      
      node.querySelector('.card-title').textContent = p.title;
      node.querySelector('.card-preview').textContent = preview(p.content);
      
      const metaHost = node.querySelector('[data-role=metadata]');
      if (metaHost) {
        try {
          metaHost.replaceChildren(buildMetadataDisplay(p.metadata));
        } catch (err) {
          console.warn('Failed to render metadata', err);
          metaHost.textContent = 'Metadata error';
        }
      }
      
      const copyBtn = node.querySelector('.copy-btn');
      copyBtn.addEventListener('click', () => copyToClipboard(p.content, copyBtn));
      
      const delBtn = node.querySelector('.delete-btn');
      delBtn.addEventListener('click', () => deletePrompt(p.id));
      
      const footer = node.querySelector('.card-footer');
      footer.appendChild(buildRatingElement(p));
      
      const cardMain = node.querySelector('.card-header').parentElement;
      cardMain.appendChild(buildNotesSection(p.id));
      
      frag.appendChild(node);
    });
    
    listEl.appendChild(frag);
  }

  // ============================================================================
  // IMPORT/EXPORT
  // ============================================================================
  
  function validatePromptRecord(p) {
    if (!p || typeof p !== 'object') throw new Error('Invalid prompt object');
    if (typeof p.id !== 'string' || !p.id) throw new Error('Prompt missing id');
    if (typeof p.title !== 'string') throw new Error('Prompt missing title');
    if (typeof p.content !== 'string') throw new Error('Prompt missing content');
  }

  function buildExportPayload() {
    const prompts = loadPrompts();
    const notesStore = loadNotesStore();
    
    const payload = {
      type: 'prompt-library-backup',
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: { prompts, notes: notesStore }
    };
    
    prompts.forEach(validatePromptRecord);
    return payload;
  }

  function triggerDownload(obj) {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const a = document.createElement('a');
    a.download = `${EXPORT_FILE_BASENAME}-${ts}.json`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { 
      URL.revokeObjectURL(a.href); 
      a.remove(); 
    }, 1000);
  }

  function exportPrompts() {
    try {
      const payload = buildExportPayload();
      triggerDownload(payload);
      showIEMessage('Export completed!', 'success');
    } catch (e) {
      console.error(e);
      showIEMessage('Export failed: ' + (e.message || e), 'error');
    }
  }

  function parseImportFile(text) {
    let data;
    try { 
      data = JSON.parse(text); 
    } catch (e) { 
      throw new Error('File is not valid JSON'); 
    }
    
    if (Array.isArray(data)) {
      const prompts = data.map(hydrateLegacyPrompt);
      prompts.forEach(validatePromptRecord);
      return { prompts, notes: {} };
    }
    
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid file format');
    }

    const typeVal = typeof data.type === 'string' ? data.type.toLowerCase() : null;
    const isModern = typeVal === 'prompt-library-backup';

    if (isModern) {
      const prompts = data?.data?.prompts;
      const notes = data?.data?.notes || {};
      if (!Array.isArray(prompts)) {
        throw new Error('Invalid prompts data');
      }
      prompts.forEach(validatePromptRecord);
      return { prompts, notes };
    }

    const promptsArr = Array.isArray(data.prompts) ? data.prompts : [];
    const legacyNotes = data.notes && typeof data.notes === 'object' ? data.notes : {};
    const prompts = promptsArr.map(hydrateLegacyPrompt);
    prompts.forEach(validatePromptRecord);
    return { prompts, notes: legacyNotes };
  }

  function mergePrompts(existing, incoming) {
    const map = new Map(existing.map(p => [p.id, p]));
    
    // Just merge - no confirmation
    for (const p of incoming) {
      map.set(p.id, p);
    }
    
    return Array.from(map.values()).sort((a,b) => 
      new Date(b.metadata?.createdAt || 0) - new Date(a.metadata?.createdAt || 0)
    );
  }

  function importFile(file) {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { prompts: incomingPrompts, notes: incomingNotes } = parseImportFile(String(reader.result));
        const existingPrompts = loadPrompts();
        const mergedPrompts = mergePrompts(existingPrompts, incomingPrompts);
        
        const currentNotes = loadNotesStore();
        const finalNotes = { ...currentNotes };
        
        for (const [pid, arr] of Object.entries(incomingNotes)) {
          if (!Array.isArray(arr)) continue;
          if (!Array.isArray(finalNotes[pid])) finalNotes[pid] = [];
          const noteIds = new Set(finalNotes[pid].map(n => n.id));
          for (const n of arr) {
            if (!n || typeof n.id !== 'string') continue;
            if (noteIds.has(n.id)) continue;
            finalNotes[pid].push(n);
          }
        }
        
        savePrompts(mergedPrompts);
        saveNotesStore(finalNotes);
        applyFiltersAndRender();
        
        showIEMessage(`Import successful! Added ${incomingPrompts.length} prompt(s).`, 'success');
      } catch (e) {
        console.error('Import error', e);
        applyFiltersAndRender();
        showIEMessage('Import failed: ' + (e.message || e), 'error');
      }
    };
    
    reader.onerror = () => {
      showIEMessage('Failed to read file', 'error');
    };
    
    reader.readAsText(file);
  }

  function showIEMessage(msg, type) {
    const host = document.getElementById('import-export-messages');
    if (!host) return;
    
    host.textContent = msg;
    host.hidden = false;
    host.className = 'iemessages ' + (type || '');
    
    clearTimeout(showIEMessage._t);
    showIEMessage._t = setTimeout(() => { 
      host.hidden = true; 
    }, 5000);
  }

  function setupImportExport() {
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const fileInput = document.getElementById('import-file');
    
    if (exportBtn) {
      exportBtn.addEventListener('click', exportPrompts);
    }
    
    if (importBtn) {
      importBtn.addEventListener('click', () => fileInput && fileInput.click());
    }
    
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const f = fileInput.files && fileInput.files[0];
        if (f) importFile(f);
        fileInput.value = '';
      });
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  function init() {
    form.addEventListener('submit', handleFormSubmit);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', clearForm);
    if (clearBtn) clearBtn.addEventListener('click', clearForm);
    
    if (searchInput) searchInput.addEventListener('input', debounce(handleSearch, 300));
    if (clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);
    if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
    
    // Event delegation for rating stars
    if (listEl) {
      listEl.addEventListener('click', (e) => {
        const starBtn = e.target.closest('button.star');
        if (starBtn && starBtn.dataset.value && starBtn.dataset.promptId) {
          e.preventDefault();
          e.stopPropagation();
          const value = Number(starBtn.dataset.value);
          const promptId = starBtn.dataset.promptId;
          console.log('Rating star clicked via delegation:', promptId, value);
          setRating(promptId, value);
        }
      });
      
      listEl.addEventListener('keydown', (e) => {
        const starBtn = e.target.closest('button.star');
        if (starBtn && starBtn.dataset.value && starBtn.dataset.promptId) {
          handleStarKey(e, starBtn.dataset.promptId);
        }
      });
    }
    
    setupImportExport();
    
    currentPrompts = loadPrompts();
    applyFiltersAndRender();
    
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    });
    
    console.log('✏️ Prompt Library initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();