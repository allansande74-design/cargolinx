# Attribution and asset rights

Every asset in the CargoLinx demo film, the application and this repository is either created by
us or used under a licence that permits commercial use and redistribution. Nothing is used
without rights. Sources are listed exactly so they can be checked.

## Photographs

**1. Mombasa container terminal** — appears in the film as the port scenes.

- File: `2015 07 31 Mombasa Port JPEG RESIZED 0040.jpg`
- Source: https://commons.wikimedia.org/wiki/File:2015_07_31_Mombasa_Port_JPEG_RESIZED_0040.jpg
- Author: Ministry of East African Affairs, Commerce and Tourism (Kenya), photographed 31 July 2015
- Licence: Public domain (published on Wikimedia Commons as a public-domain work)
- Changes made: downscaled, cropped to a 1350x630 card, and a credit line burned into the
  bottom bar. No other alteration.
- Where used: `out/demo/work_v5film/shots/port_card.png`; film scenes 4 and 5.

**2. Reels of electrical line ready for pickup** — appears in the film as the cable scene.

- File: `FEMA - 44341 - Reels of electrical line ready for pickup in Oklahoma.jpg`
- Source: https://commons.wikimedia.org/wiki/File:FEMA_-_44341_-_Reels_of_electrical_line_ready_for_pickup_in_Oklahoma.jpg
- Author: Win Henderson, Federal Emergency Management Agency, 20 May 2010
- Licence: Public domain (work of the United States federal government, 17 U.S.C. 105)
- Changes made: downscaled, cropped to a 1350x630 card, credit line burned in.
- Where used: `out/demo/work_v5film/shots/cargo_reels_card.png`; film scenes 7 and 13.

## Images we generated

**3. Object-segmentation proof image** — a 1600x1600 image generated with Meta Muse Image from our
own prompt, used as the input to a recorded SAM 3.1 call. The recorded response and the decoded
masks are kept in `out/evidence/` (`meta_sam_proof.json`, rendered by `out/demo/mask_card.py`).
Rights: ours. It does not appear in the delivered cut.

## Screens and documents made by the product

- Application screens (`app_home.png`, `app_desk.png`, `app_deskquotes.png`): captured headless from
  this repository's own build.
- Quotation, delivery note and packing list (`quote_doc_crop.png`, `delivery-note_crop.png`,
  `packing-list_crop.png`): rendered by `src/lib/quote-doc.mjs` and `src/lib/doc-templates.mjs` for
  order CLX-261031-714. Our own output, no third-party content.

## Type and audio

- Typeface in the film and documents: DejaVu Sans, Bitstream Vera / Public Domain licence, free for
  commercial use and redistribution.
- Narration: written by us and synthesised from our own script (`out/demo/narration_pass.py`). No
  licensed music or stock audio is used anywhere in the film.

## Software

Third-party libraries are listed with their licences in `package.json` and their own licence files
under `node_modules` at install time; the project is MIT licensed (see `LICENSE`).

## Contact

Dreamteam Consulting Company (DreamTeQ) / Altovex Global Logistics — dreamteamconsult@gmx.com
