# Video assets and licences

Plan non-negotiable 5: no third-party effect, sticker, font or music is bundled unless its licence allows commercial
newsroom use, and the licence is recorded here. **ESB Studio ships no music at all.** The Audio tab's music library reads
only from a folder the owner chooses (read-only); every track the editor uses is the editor's own responsibility, and
the Licence note on each track (kept in the `.esbvideo` project file) says where it came from and what it allows.

## Bundled with the app

| Asset | Kind | Made by | Licence | Commercial newsroom use |
|---|---|---|---|---|
| Transitions, titles, stickers, LUT presets, UI sounds | code-drawn / repo-made | ESB | Own work | yes |
| Inter (ESB Sans), Hind Siliguri, Oswald, Space Grotesk | fonts | see `src/assets/fonts` | SIL OFL 1.1 | yes |
| Music | none bundled | n/a | n/a | n/a |

Add a row for anything new in the same pull request that adds it, with the licence text or its URL and the date checked.

## Music library (the owner's folder)

The library lists audio files under the chosen folder (MP3, WAV, M4A, AAC, OGG, Opus, FLAC; up to three folders deep).
Title and tags are read from the file name: `Title [tag, tag] #tag.mp3`; folder names count as tags.

For each track used in a video, keep a note in the app (Audio tab, track row, **Licence**) or here:

| Track (file name) | Source / who supplied it | Licence and conditions | Credit line required | Valid until | Checked by, date |
|---|---|---|---|---|---|
| _example: Morning Drive.mp3_ | _supplier name, order or invoice number_ | _e.g. Standard commercial licence, broadcast and online_ | _yes / no, exact text_ | _date or perpetual_ | _name, date_ |

Rules of thumb:
- A track with no written licence is not used in a published video.
- "Free to download" is not a licence. Keep the licence page or the invoice.
- Creative Commons NC (non-commercial) licences do not cover a newsroom's published video.
- Credit lines go in the video description (Phase 5 video copy will list the tracks that carry one).
