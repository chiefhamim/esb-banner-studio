# Extraction fixtures

Hand-written pages for `tools/e2e/extract-test.mjs`. They follow the public conventions news sites use
(schema.org `NewsArticle` JSON-LD, OpenGraph meta, an `<article>` block beside navigation and
related-story rails, a Next.js `__NEXT_DATA__` blob) and are **not** captures of any publisher's
page. Keep them that way: a fixture must never carry a real site's copyrighted text or markup.

`media/synthetic-rig.jpg` is a drawn gradient-and-lines picture (made with PIL for these tests, no
photograph). The browser suites route every fixture image request (`**/media/**`) to it, so the
featured-image editor and banner have real pixels to work on without any network.
