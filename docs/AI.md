# AI rewrite guide

## Browser studio

1. Open the studio, choose a Nightly, and add a JAR you can port or a built-in example.
2. Select **Basic functions only** for the rule-based Rust generator, **All supported conversions** to include recipe and recognized startup ports, or **Inspect only** for an inventory.
3. Start the conversion and open its result. Under **On-device AI rewrite**, choose a method and click **Generate Rust draft**.
4. Review the draft, then download the `.rs` file. Compare it with the original method and the target Nightly's source before integrating it into a project.

The browser uses WebLLM and a small Qwen2.5-Coder model in a dedicated WebGPU worker. It downloads model weights from Hugging Face and a runtime from MLC on the first run, then uses the device’s GPU and memory. Method text and JAR contents stay on the device. The model cache belongs to the browser and can be removed through site data settings.

You can leave the controls idle while generation runs. Keep the tab open and the device awake. On some phones the browser or operating system may pause work when switching apps, locking the screen, or reclaiming memory. Use **Keep the screen awake** where supported, and use **Cancel rewrite** to stop work or free model memory. If a device has no compatible WebGPU adapter, the rules-only modes still work. [WebLLM device and worker documentation](https://webllm.mlc.ai/docs/index.html)

## Locally hosted with Ollama

Install and start Ollama, then pull a model on the machine that will run inference. In PowerShell, run the following from the project directory after following the main README’s Python and Node setup.

```powershell
ollama pull qwen2.5-coder:1.5b
$env:HB_AI_MODEL = 'qwen2.5-coder:1.5b'
python scripts/dev.py
```

The default endpoint is `http://127.0.0.1:11434`. If Ollama is running on another machine you control, set `HB_AI_URL` to its base URL. In the local UI, enable **AI Rust drafts for this job** before starting a conversion. After the results load, pick a reconstructed Java file or an available JVM method and generate the draft. If a method could not be decoded, use the self-hosted profile with Vineflower for Java file selection.

## Other self-hosted inference servers

Use `HB_AI_PROVIDER=openai-compatible`, set `HB_AI_URL` to the server’s `/v1` base URL, and set `HB_AI_MODEL` to the served model name. If the server is configured with a key, set `HB_AI_TOKEN` in the host environment. The backend uses structured JSON Chat Completions. A compatible server such as llama.cpp can run on the same PC or on a machine you control. For Docker, use an endpoint reachable from the API container. [Ollama chat API](https://docs.ollama.com/api/chat) · [llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

## Review and privacy notices

- Only the selected file or method and its target are sent to a configured inference server. The on-device browser option sends neither JARs nor code to a server.
- AI drafts are separate downloads. The app displays the proposed code and assumptions as text. It never executes or includes a draft automatically in an installable mod.
- Small models can misread control flow, Java overflow, or game-specific APIs. Test the generated Rust against the original behavior and the exact Horizon revision before use.
- Server drafts follow the conversion’s retention window. Browser drafts are held in the current tab until you download or clear them.
