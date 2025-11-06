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
4. Watch the player overlay in the top-right—it displays the current playback rate, raw heat ratio, and speed ratio so you can see adjustments live (even while scrubbing).

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

## License

MIT © 2025 setrf. See [LICENSE](LICENSE) for full text.
