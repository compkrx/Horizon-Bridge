# Troubleshooting

**The Pages app cannot reach the converter.** Check `/api/config` through Pages. A 503 typically means the Function environment is incomplete. A 502 points to origin DNS, TLS, or connectivity. A 403 usually indicates a mismatch between the Pages secret and the API secret.

**The upload is rejected.** Use a valid JAR smaller than 32 MiB. The processor also limits entry count and decompressed size. A structurally invalid archive ends the job with an error. Repair the source archive and create a new job.

**A job remains queued.** Check `docker compose logs processor` and confirm both services use the same `jobs` volume. A Landlock startup failure means the host kernel, runtime policy, or processor architecture lacks the required sandbox support. Move the service to a compatible host.

**There is no `.hnmod` download.** Check the report. A standalone Rust library needs a verified Horizon entry point. A mapped candidate also needs the full toolchain and successful native compilation and packaging. Failed candidates remain available as source where possible.

**A content file is omitted.** The converter uses a narrow asset/data allowlist and the pinned official tool. See the feature rows and diagnostics for exclusions. Java registration and runtime behavior still need a separate port.

**The source preview is unavailable.** Preview lists are bounded and include text files only. Use the source archive to inspect all exported files.

**A retry is unavailable.** Jobs permit one retry for recoverable processing failures. Cancelled, expired, structurally invalid, and exhausted jobs require a new authorized upload.

**The advisor is unavailable.** Enable the model settings on the origin, opt in on a new job, and confirm the API container can reach the configured `/api/chat` endpoint. Ordinary analysis and conversion can run independently.
