# site.bazinga.ink

Code for https://site.bazinga.ink/.

## Technology

- HTML, CSS, Anti-JavaScript JavaScript
- [RSS](https://en.wikipedia.org/wiki/RSS)
- [Jekyll](https://jekyllrb.com/)
- [OpenStories](https://github.com/dddddddddzzzz/OpenStories), [`<open-stories>`](https://github.com/dddddddddzzzz/open-stories-element)
- [OpenHeart](https://github.com/dddddddddzzzz/OpenHeart), [`<open-heart>`](https://github.com/dddddddddzzzz/open-heart-element)

## Development

Requires a Ruby environment.

```bash
$ ./start
```

## Environment

Copy `.env.example` to your local environment and fill in the real values.

```bash
cp .env.example .env.local
```

### Required variables

```bash
GITHUB_TOKEN=your_github_token
GITHUB_REPO=owner/repo
WRITE_ACCESS_KEY=your_write_access_key
LLM_API_KEY=your_kimi_api_key
LLM_MODEL=kimi-k2.5
LLM_BASE_URL=https://api.moonshot.cn/v1
```

### Notes

- `LLM_API_KEY` is only used by server-side API routes and the local Node script. It must never be exposed to browser code or committed into the repository.
- `LLM_MODEL` should stay pinned in production. Update it manually only after checking summary quality on a few real posts.
- `LLM_BASE_URL` is set up for the domestic Kimi OpenAI-compatible endpoint.

## License

The following directories and their contents are Copyright Bazinga. You may not reuse anything therein without permission:

```text
_data/
_posts/
_stories/
_notes/
images/
```

All other directories and files are MIT Licensed (where applicable).
