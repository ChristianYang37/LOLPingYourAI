# Attribution

LOLPingYourAI derives its desktop input helper, radial wheels, Electron overlays, settings and emote-import code from [darrenprx/lolPing](https://github.com/darrenprx/lolPing), version 0.5.1, commit `f24a51e5a11c2b31dab72d89a571cc4025ad3c98`. Copyright © 2026 Danrui Meng; MIT. The original copyright is retained in LICENSE.

The bundled `assets/textures`, `assets/sounds` and `assets/emotes` are copied from that pinned upstream revision: League of Legends artwork, animations and audio © Riot Games, Inc. They are not MIT-licensed. The additional nice/celebrate texture aliases are byte-identical copies of the upstream `super_approved` and `gg_heart` emote stills. The monochrome macOS menu-bar status icons are from the upstream build directory. The application logo (`build/icon.png` and its Windows ICO derivative) was supplied by the project owner on 2026-10-15; it is excluded from the code MIT license, and depicted third-party artwork and marks remain with their respective owners. The previous original geometric pack and synthesized sounds have been removed. The demo video, GIF and images in `docs/media` are rendered from the `promo/` sources and show and play those same League of Legends assets, so the same exclusion from MIT applies to them; `promo/` copies the assets at build time rather than duplicating them in Git.

This independent project is not endorsed by Riot Games, OpenAI or Anthropic. League of Legends and associated marks belong to Riot Games. Including assets here does not grant rights to redistribute them under MIT.

Runtime libraries remain under their respective package licenses; see pnpm-lock.yaml.

The reusable tools under `tools/acceptance/` adapt the acceptance-driving, observation and timeline ideas/code contributed by csxq0605 in [PR #8](https://github.com/ChristianYang37/LOLPingYourAI/pull/8), under this repository's MIT license. The original recordings, screenshots, personal state and session logs are not included in this tool package.
