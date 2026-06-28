const api = typeof browser !== 'undefined' ? browser : chrome;

const MODEL_MAP = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  groq: ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  ollama: []
};

function populateModels(provider) {
  const select = document.getElementById('select-model');
  const customSection = document.getElementById('section-model-custom');
  const modelSelectSection = document.getElementById('section-model-select');
  const apiKeySection = document.getElementById('section-api-key');

  if (provider === 'ollama') {
    modelSelectSection.classList.add('settings-hidden');
    customSection.classList.remove('settings-hidden');
    apiKeySection.classList.add('settings-hidden');
  } else {
    customSection.classList.add('settings-hidden');
    modelSelectSection.classList.remove('settings-hidden');
    apiKeySection.classList.remove('settings-hidden');

    select.innerHTML = '';
    const models = MODEL_MAP[provider] || [];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });
  }
}

function getSelectedModel() {
  const provider = document.getElementById('select-provider').value;
  if (provider === 'ollama') {
    return document.getElementById('input-model-custom').value.trim();
  }
  return document.getElementById('select-model').value;
}

function setSelectedModel(provider, model) {
  if (provider === 'ollama') {
    document.getElementById('input-model-custom').value = model || '';
  } else {
    const select = document.getElementById('select-model');
    if (model && select.querySelector(`option[value="${model}"]`)) {
      select.value = model;
    }
  }
}

async function handleSave() {
  const provider = document.getElementById('select-provider').value;
  const model = getSelectedModel();
  const apiKey = provider === 'ollama' ? '' : document.getElementById('input-api-key').value.trim();

  console.log('[Staple][popup:handleSave] Saving settings', { provider, model, hasKey: apiKey.length > 0 });

  if (!apiKey && provider !== 'ollama') {
    console.warn('[Staple][popup:handleSave] Saving empty API key for provider that requires one', { provider });
  }

  await new Promise(resolve => {
    api.storage.sync.set({ provider, model, apiKey }, () => {
      if (api.runtime.lastError) {
        console.error('[Staple][popup:handleSave] chrome.storage.sync.set failed', { error: api.runtime.lastError.message });
      } else {
        console.log('[Staple][popup:handleSave] Settings saved successfully');
      }
      resolve();
    });
  });

  document.getElementById('save-status').innerText = 'Saved';
  setTimeout(() => {
    document.getElementById('save-status').innerText = '';
  }, 1500);
}

function bindEvents() {
  const providerSelect = document.getElementById('select-provider');

  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    if (!MODEL_MAP[provider]) {
      console.error('[Staple][popup:onProviderChange] Selected provider not in MODEL_MAP', { provider });
    }
    populateModels(provider);
  });

  document.getElementById('save-btn').onclick = handleSave;

  api.storage.sync.get(['provider', 'model', 'apiKey', 'deepseekKey'], data => {
    if (api.runtime.lastError) {
      console.error('[Staple][popup:loadSettings] chrome.storage.sync.get failed', { error: api.runtime.lastError.message });
    }
    let provider = data.provider || 'deepseek';
    let model = data.model || 'deepseek-v4-flash';
    let apiKey = data.apiKey || '';

    if (!apiKey && data.deepseekKey) {
      apiKey = data.deepseekKey;
      provider = 'deepseek';
      model = 'deepseek-v4-flash';
      console.log('[Staple][popup:loadSettings] Migrated deepseekKey to apiKey');
      api.storage.sync.set({ apiKey, provider, model });
    }

    console.log('[Staple][popup:loadSettings] Loaded settings', { provider, model, hasKey: (apiKey || '').length > 0 });

    providerSelect.value = provider || 'deepseek';
    populateModels(provider);
    setSelectedModel(provider, model);
    document.getElementById('input-api-key').value = apiKey || '';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindEvents);
} else {
  bindEvents();
}
