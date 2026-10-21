# Core Share card payload — v1

A share today carries one thing: a URL, from which the receiving app builds a preview. A Core Share card carries several layers at once, so the receiving side can show whichever it can (the same idea as a clipboard holding several representations).

```jsonc
{
  "v": 1,
  "source": {                      // the container
    "platform": "youtube",
    "video_id": "aircAruvnKk",
    "url": "https://www.youtube.com/watch?v=aircAruvnKk",
    "title": "…",
    "channel": "…",
    "duration": 1120               // seconds
  },
  "sender": {                      // the sender's own input
    "name": "…",                   // display name chosen by the sender
    "note": "…",                   // shown exactly as written; never rewritten by AI
    "entry": "share | mark | icon",// which way the card was started
    "marks": [{ "t": 170.2, "reaction": "…" }],
    "selected": ["u3"]             // units the sender ticked by hand
  },
  "ai": {                          // the AI's contribution, always labeled "AI"
    "available": true,
    "model": "…",
    "intent_primary": "pointer | discussion | recommend | fun | info",
    "intent_secondary": null,
    "about_recipient": false,      // triggered by thinking of the recipient
    "summary_type": "indicative | informative | evaluative | none",
    "headline": "…",               // the AI line as sent (after any edit)
    "headline_ai": "…",            // the AI's original line
    "headline_edited": false,
    "points": [{ "text": "…", "t": 162 }], // informative points, each tied to a time
    "rationale": "…",              // shown to the sender only
    "not_found": false,            // the note refers to something the video lacks
    "clarify": { "question": "…", "answer": "…" },
    "parts_changed": false         // sender added or removed parts after the AI chose
  },
  "core": {                        // the selection
    "ranges": [
      { "start": 162, "end": 331, "title": "…", "snippet": "…" } // snippet = transcript text, kept so the core survives if the video can't be opened
    ],
    "duration": 169                // seconds of core; shown with the whole duration
  }
}
```

## Rules

1. **Two voices.** `ai.headline` is written by AI and labeled "AI" wherever it appears. `sender.note` is the sender's words, unchanged. They are shown in different type and never merged.
2. **Marks are approximate points.** Each mark includes the whole unit (chapter, or about one minute) that contains it.
3. **Scattered cores are allowed.** `core.ranges` can hold several non-adjacent parts.
4. **Fun shares get no AI line.** `summary_type = none`, `headline = null`.
5. **Fallbacks.** No AI: the card carries the sender's parts and note without an AI line. No transcript: the AI works from chapter titles only. Video unavailable: `core.ranges[].snippet` still shows what was said.
6. **Nothing is sent before the sender reviews the card** and creates the link.

## Receiving side (layers)

1. Card: AI line + sender's note + "The part: X min · Whole video: Y min" (also drawn into the link-preview image, because messaging apps often show only the image and title).
2. The part(s): each range plays from start to end; each AI point jumps to its time.
3. The whole content on its original site.
