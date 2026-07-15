import { GenMode, PrefillFlavor, updateSettings, useSettings } from "../state/settings";

export default function SettingsPanel() {
  const s = useSettings();

  return (
    <aside className="settings">
      <h2>Provider</h2>
      <label>
        Base URL
        <input
          value={s.baseUrl}
          onChange={(e) => updateSettings({ baseUrl: e.target.value })}
          placeholder="http://localhost:11434/v1"
        />
      </label>
      <label>
        API key
        <input
          type="password"
          value={s.apiKey}
          onChange={(e) => updateSettings({ apiKey: e.target.value })}
          placeholder="(empty for local servers)"
        />
      </label>
      <label>
        Model
        <input value={s.model} onChange={(e) => updateSettings({ model: e.target.value })} placeholder="deepseek-chat" />
      </label>

      <h2>Generation</h2>
      <label>
        Continue mode
        <select value={s.mode} onChange={(e) => updateSettings({ mode: e.target.value as GenMode })}>
          <option value="ask">ask — instruct model to continue</option>
          <option value="prefill">prefill — continue assistant message</option>
        </select>
      </label>
      {s.mode === "prefill" && (
        <label>
          Prefill flavor
          <select
            value={s.prefillFlavor}
            onChange={(e) => updateSettings({ prefillFlavor: e.target.value as PrefillFlavor })}
          >
            <option value="prefix-field">prefix: true (DeepSeek beta, Mistral)</option>
            <option value="vllm">continue_final_message (vLLM, TabbyAPI)</option>
            <option value="raw">raw trailing assistant message</option>
          </select>
        </label>
      )}
      <label>
        Temperature
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={s.temperature}
          onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
        />
      </label>
      <label>
        Max tokens
        <input
          type="number"
          step="64"
          min="1"
          value={s.maxTokens}
          onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
        />
      </label>
      <label>
        Max context (chars)
        <input
          type="number"
          step="1000"
          min="500"
          value={s.maxContextChars}
          onChange={(e) => updateSettings({ maxContextChars: Number(e.target.value) })}
        />
      </label>

      <h2>Prompts</h2>
      <label>
        Ask-mode system prompt
        <textarea
          rows={6}
          value={s.systemPromptAsk}
          onChange={(e) => updateSettings({ systemPromptAsk: e.target.value })}
        />
      </label>
      {s.mode === "prefill" && (
        <>
          <label>
            Prefill system prompt (optional)
            <textarea
              rows={3}
              value={s.systemPromptPrefill}
              onChange={(e) => updateSettings({ systemPromptPrefill: e.target.value })}
            />
          </label>
          <label>
            Prefill user message
            <input
              value={s.userPromptPrefill}
              onChange={(e) => updateSettings({ userPromptPrefill: e.target.value })}
            />
          </label>
        </>
      )}
      <label>
        Popup (Ctrl+K) system prompt
        <textarea
          rows={6}
          value={s.systemPromptPopup}
          onChange={(e) => updateSettings({ systemPromptPopup: e.target.value })}
        />
      </label>

      <p className="hint">
        <kbd>Ctrl+Enter</kbd> continue · <kbd>Ctrl+K</kbd> instruct · <kbd>Esc</kbd> stop
      </p>
    </aside>
  );
}
