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
            <option value="raw">raw trailing assistant message (OpenRouter)</option>
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
        Continue max tokens (Ctrl+Enter)
        <input
          type="number"
          step="64"
          min="1"
          value={s.continueMaxTokens}
          onChange={(e) => updateSettings({ continueMaxTokens: Number(e.target.value) })}
        />
      </label>
      <label>
        Ctrl+K token budget (includes reasoning)
        <input
          type="number"
          step="256"
          min="1"
          value={s.popupMaxTokens}
          onChange={(e) => updateSettings({ popupMaxTokens: Number(e.target.value) })}
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
      {s.mode === "ask" && (
        <RequestExtrasEditor
          label="Ask-mode continuation"
          field="askExtraBody"
          value={s.askExtraBody}
        />
      )}
      <RequestExtrasEditor
        label="Ctrl+K instruction"
        field="popupExtraBody"
        value={s.popupExtraBody}
      />

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
        <kbd>Ctrl+Enter</kbd> continue · <kbd>Ctrl+Shift+Enter</kbd> replace · <kbd>Ctrl+K</kbd>{" "}
        instruct · <kbd>Esc</kbd> stop
      </p>
    </aside>
  );
}

const EXTRA_BODY_PRESETS = [
  { id: "default", label: "Provider default (no extras)", body: "" },
  {
    id: "openai-off",
    label: "OpenAI — reasoning off",
    body: '{\n  "reasoning_effort": "none"\n}',
  },
  {
    id: "openai-low",
    label: "OpenAI — low reasoning",
    body: '{\n  "reasoning_effort": "low"\n}',
  },
  {
    id: "openrouter-off",
    label: "OpenRouter — reasoning off",
    body: '{\n  "reasoning": {\n    "effort": "none"\n  }\n}',
  },
  {
    id: "openrouter-low",
    label: "OpenRouter — low reasoning",
    body: '{\n  "reasoning": {\n    "effort": "low"\n  }\n}',
  },
  {
    id: "deepseek-off",
    label: "DeepSeek — thinking off",
    body: '{\n  "thinking": {\n    "type": "disabled"\n  }\n}',
  },
  {
    id: "deepseek-on",
    label: "DeepSeek — thinking on",
    body: '{\n  "thinking": {\n    "type": "enabled"\n  }\n}',
  },
] as const;

function RequestExtrasEditor({
  label,
  field,
  value,
}: {
  label: string;
  field: "askExtraBody" | "popupExtraBody";
  value: string;
}) {
  const selectedPreset = EXTRA_BODY_PRESETS.find((preset) => preset.body === value)?.id ?? "custom";
  const setValue = (next: string) => {
    if (field === "askExtraBody") updateSettings({ askExtraBody: next });
    else updateSettings({ popupExtraBody: next });
  };

  return (
    <div className="request-extras">
      <label>
        {label} preset
        <select
          value={selectedPreset}
          onChange={(event) => {
            const preset = EXTRA_BODY_PRESETS.find(({ id }) => id === event.target.value);
            if (preset) setValue(preset.body);
          }}
        >
          {selectedPreset === "custom" && <option value="custom">Custom JSON</option>}
          {EXTRA_BODY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </label>
      <label>
        {label} extra request body (JSON)
        <textarea
          rows={4}
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="{}"
        />
      </label>
      <p className="field-hint">A preset replaces this JSON; it remains editable afterward.</p>
    </div>
  );
}
