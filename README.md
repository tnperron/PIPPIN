## Configuration

To configure the application:
1. Copy `example.env` to `.env`.
2. Replace placeholders with your information.
3. Customize index.html and style.css to your liking.


## TODO

Internals:
- [x] Include all imeta tag info except for title and fallbacks.
- [x] Exclude annotate-user and content-warning.
- [x] Hard-code language tag to Canadian English.
- [ ] Add ability to upload multiple photos in single post.
- [x] Build "client" tag for internet points.
- [x] Name the app and change out the placeholders.
        Changed name to "Pippin", "Photos In Pretty Posts In Nostr".
- [ ] Add video function.
        Make sure verticle videos are handled correctly.
- [x] Add default npub to display if no user signed in.
- [ ] Add logic to use multiple relays.

Interface:
- [x] Reverse order of posts; newest should be at top.
- [ ] Add reaction/likes button and display.
        Added, but not yet working.
- [ ] Add repost button.
        Added, but not yet working.
- [ ] Add zap button / functionality.
        Added, but not yet working.
- [ ] Add comment button and display / functionality.
        Added, but not yet working.  Should comments on comments be added?  Leaning toward not.
- [x] Add poster profile pic, name, post time/date, and NIP-05 name and checkmark.
- [ ] Load an amount of posts at a time / infinite scroll.
        Loads 10 at a time, but infinite scroll (loading more) is buggy.
- [x] Move new post section to top of page.


Wishlist / For consideration:
1. Add border to new post section.
2. Add a dark mode switch.
3. Make note content box bigger?