## Configuration

To configure the application:
1. Copy `example.env` to `.env`.
2. Replace placeholders with your information.
3. Customize index.html and style.css to your liking.


## TODO

Internals:
✅  1: Include all imeta tag info except for title and fallbacks.
✅  2: Exclude annotate-user and content-warning.
✅  3: Hard-code language tag to Canadian English.
    4: Add ability to upload multiple photos in single post.
✅  5: Build "client" tag for internet points.
✅  6: Name the app and change out the placeholders.
        Changed name to "Pippin", "Photos In Pretty Posts In Nostr".
    7: Add video function.
        Make sure verticle videos are handled correctly.
✅  8: Add default npub to display if no user signed in.
    9: Add logic to use multiple relays.

Interface:
✅  1: Reverse order of posts; newest should be at top.
    2: Add reaction/likes button and display.
        Added, but not yet working.
    3: Add repost button.
        Added, but not yet working.
    4: Add zap button / functionality.
        Added, but not yet working.
    5: Add comment button and display / functionality.
        Added, but not yet working.  Should comments on comments be added?  Leaning toward not.
✅  6: Add poster profile pic, name, post time/date, and NIP-05 name and checkmark.
    7: Load an amount of posts at a time / infinite scroll.
        Loads 10 at a time, but infinite scroll (loading more) is buggy.
✅  8: Move new post section to top of page.


Wishlist / For consideration:
    1: Add border to new post section.
    2: Add a dark mode switch.
    3: Make note content box bigger?