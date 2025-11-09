# KineWatch

KineWatch is a Chrome extension that uses YouTube’s “Most replayed” heat-map data to modulate playback speed in real time:

- **Slow down** when the crowd replays a segment the most.
- **Speed up** through the quiet stretches—no more manual scrubbing.

## Install (unpacked)

1. Clone/download this repository.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the `extension/` directory.

## Usage

1. Open a YouTube watch page.
2. Launch the KineWatch popup.
3. Set your minimum and maximum speeds (defaults to 1×–2×, range 0.1×–16×) and press **Save & apply**.
4. Use the quick preset chips for one-tap control—the in-player mini overlay shows the current playback rate and target so you can close the popup while watching.
5. Adjust the **Advanced controls** panel to fine-tune smoothing or heat-map refresh cadence if you want gentler ramps or lighter CPU usage.

## How it works

- Every “Most replayed” chapter is a 1000×100 SVG containing cubic Bézier curves.  
- KineWatch samples the endpoints of those curves, projects them onto the full video timeline using chapter offsets, and tracks the global min/max raw `y` values.  
- Playback speed (`video.playbackRate`) is derived strictly from that raw range, guaranteeing that every video hits your configured minimum and maximum speeds.
- A mutation observer plus `yt-navigate-*` listeners keep the script attached across YouTube’s SPA navigation.

## Project structure

```
extension/
  ├─ manifest.json
  ├─ contentScript.js
  ├─ popup.html
  ├─ popup.js
  └─ popup.css
```

## Development

- Reload the unpacked extension after making changes.
- The project uses vanilla JavaScript/Manifest V3—no build step or bundler required.

## Chrome Web Store submission

1. **Bump the version** in `extension/manifest.json` before every upload (Web Store requires a monotonically increasing version).
2. **Generate a distribution ZIP** by running `./scripts/package-extension.sh`. The archive is emitted to `release/kinewatch-extension.zip` and already excludes macOS metadata.
3. **Gather listing assets**:
   - Icons (16/32/48/128/256 px) live in `extension/icons/` and are referenced in the manifest.
   - Capture at least one 1280×800 screenshot or short promo video showcasing the popup + adaptive playback (Chrome Web Store requirement).
4. **Prepare listing copy** (you can reuse the README sections for description/features) and submit the ZIP via <https://chrome.google.com/webstore/devconsole>.
5. During review, Chrome will re-check permissions; KineWatch only requests `tabs`, `storage`, and the YouTube host permission as declared in the manifest.

> Tip: keep `release/` out of git (it’s already ignored) and re-run the script every time you tweak the source so the ZIP stays in sync.

## License

MIT © 2025 setrf. See [LICENSE](LICENSE) for full text.
