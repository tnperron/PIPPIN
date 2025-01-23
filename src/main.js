import { Relay, getEventHash } from "nostr-tools";
import { decode } from "bech32";
//require('dotenv').config();

const relayURL = import.meta.env.VITE_RELAY_URL;
const blossomURL = import.meta.env.VITE_BLOSSOM_URL;
const defaultPubKey = import.meta.env.VITE_DEFAULT_PUBKEY;
const zapAmount = import.meta.env.VITE_ZAP_AMOUNT;

const notesSection = document.getElementById("notes");
const noteForm = document.getElementById("note-form");
const noteContent = document.getElementById("note-content");
const photoUpload = document.getElementById("photo-upload");

async function uploadPhoto(file) {
  const formData = new FormData();
  formData.append("file", file, file.name);

  try {
    // Generate SHA-256 hash of the file
    const fileBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Ensure the Nostr signing extension is available
    if (!window.nostr) {
      throw new Error("NIP-07 signing extension not found.");
    }

    // Get the user's public key from the signing extension
    const pubkey = await window.nostr.getPublicKey();

    // Define an expiration time for the authorization (e.g., 5 minutes from now)
    const expirationTime = Math.floor(Date.now() / 1000) + 300;

    // Construct the authorization event
    const authEvent = {
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["t", "upload"],
        ["x", hashHex],
        ["expiration", expirationTime.toString()],
      ],
      content: "Upload authorization for Blossom",
      pubkey,
    };

    // Generate event hash
    authEvent.id = getEventHash(authEvent);

    // Sign the event using Nostr extension
    const signedEvent = await window.nostr.signEvent(authEvent);

    // Extract only the signature from the signed event
    if (signedEvent.sig) {
      authEvent.sig = signedEvent.sig;
    } else {
      throw new Error("Signature missing from signed event");
    }

    // Base64 encode the authorization event
    const base64AuthEvent = btoa(JSON.stringify(authEvent));

    // Send the file with the base64-encoded authorization event in the Authorization header
    const response = await fetch(blossomURL, {
      method: "PUT",
      headers: {
        Authorization: `Nostr ${base64AuthEvent}`,
      },
      body: file,
    });

    if (!response.ok) {
      throw new Error(`Photo upload failed: ${response.statusText}`);
    }

    const responseData = await response.json();
    return responseData.url;
  } catch (error) {
    console.error("Error uploading photo:", error);
    throw error;
  }
}


async function publishNoteWithPhoto() {
  const content = noteContent.value.trim();
  if (!content) {
    alert("Note content cannot be empty!");
    return;
  }

  const file = photoUpload.files[0];
  let photoURL = null;

  if (file) {
    try {
      photoURL = await uploadPhoto(file);
    } catch (error) {
      alert("Failed to upload photo. See console for details.");
      return;
    }
  }

  async function generateFileHash(file) {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function npubToHex(npub) {
    const { data } = decode(npub.replace("npub", ""));
    return Buffer.from(data).toString("hex");
  }

  async function resolveNip05Identifier(nip05) {
    const [username, domain] = nip05.split("@");
    const url = `https://${domain}/.well-known/nostr.json?name=${username}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.names[username];
  }

  async function createPTagsFromContent(content) {
    const npubRegex = /\bnpub1[0-9a-z]{59}\b/g; // Matches npub strings
    const nip05Regex = /\b[\w.-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g; // Matches username@domain
  
    const npubMatches = [...content.matchAll(npubRegex)];
    const nip05Matches = [...content.matchAll(nip05Regex)];
  
    const pTags = [];
  
    // Process npub matches
    for (const match of npubMatches) {
      try {
        const pubkey = npubToHex(match[0]);
        pTags.push(["p", pubkey]);
      } catch (error) {
        console.error(`Failed to process npub: ${match[0]}`, error);
      }
    }
  
    // Process NIP-05 matches
    for (const match of nip05Matches) {
      try {
        const pubkey = await resolveNip05Identifier(match[0]);
        pTags.push(["p", pubkey]);
      } catch (error) {
        console.error(`Failed to resolve NIP-05 identifier: ${match[0]}`, error);
      }
    }
  
    return pTags;
  }
  

  function extractHashtags(content) {
    const hashtagRegex = /#(\w+)/g;
    const matches = [...content.matchAll(hashtagRegex)];
    return matches.map(match => match[1]);
  }
  

  try {
    if (!window.nostr) {
      throw new Error("NIP-07 signing extension not found.");
    }

    const pubkey = await window.nostr.getPublicKey();

    // Create the Kind 20 event
    const mimeType = file.type;
    const hashHex = await generateFileHash(file);
    const hashtags = extractHashtags(content);
    const tTags = hashtags.map(tag => ["t", tag]);
    const pTags = await createPTagsFromContent(content);
    const event = {
      kind: 20,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["imeta", `url ${photoURL}`, `m ${mimeType}`, `alt Kind 20 photo posted from PIPPIN`, `x ${hashHex}`],
            ...pTags,
            ["m", mimeType],
            ["x", hashHex],
            ...tTags,
            ["L", "ISO-639-1"],
            ["l", "en", "ISO-639-1"],
            ["client", "PIPPIN", "31990:fe2fb6daf39a23cb1a650d2aa052a22f8ed042893f8aa1c1d625012f07578834", "wss://nostrrelay.taylorperron.com"]],
      content: content,
      pubkey,
    };

    // Hash the event
    event.id = getEventHash(event);

    //Sign the event without recursively including the event
    const signedEvent = await window.nostr.signEvent(event);
    if (!signedEvent.sig) {
    throw new Error("Signing failed, no signature returned");
    }

    // Assign the signature to the event
    event.sig = signedEvent.sig;

    // Publish the event to the relay
    const relay = new Relay(relayURL);
    await relay.connect();
    relay.publish(event);

    // Clear the form
    noteContent.value = "";
    photoUpload.value = null;
    alert("Kind 20 note published successfully!");
  } catch (error) {
    console.error("Error publishing Kind 20 note:", error);
    alert("Failed to publish Kind 20 note. See console for details.");
  }
}

noteForm.addEventListener("submit", (e) => {
  e.preventDefault();
  publishNoteWithPhoto();
});

async function initializeClient() {
  let userPubKey = null;

  // Check if the user is signed in using NIP-07
  if (window.nostr) {
    try {
      userPubKey = await window.nostr.getPublicKey();
      console.log("User is signed in with pubkey:", userPubKey);
    } catch (error) {
      console.error("Failed to retrieve user public key:", error);
    }
  }

  // If not signed in, use the default public key
  if (!userPubKey) {
    console.log("No user signed in. Displaying notes for the default account.");
    fetchDefaultNotes();
  } else {
    console.log("User signed in. Displaying user's' feed.");
    fetchUserFeed(userPubKey);
  }
}

async function fetchDefaultNotes(limit = 10) {
  console.log("Fetching notes for the default account...");

  const relay = new Relay(relayURL);
  try {
    await relay.connect();
    console.log("Relay connected for default account.");

    const filters = [{ kinds: [20], authors: [defaultPubKey], until: lastSeenCreatedAt - 1, limit }];

    const tempNotes = []; // Temporary array for this batch of notes
    const subscription = relay.subscribe(filters, {});

    subscription.onevent = (event) => {
      console.log("Received default account note with created_at:", event.created_at);

      // Add to tempNotes if not already present
      if (!tempNotes.some(note => note.id === event.id)) {
        console.log("Adding note to tempNotes:", event.id);
        tempNotes.push(event);
      } else {
        console.log("Duplicate note skipped in tempNotes:", event.id);
      }
    };

    subscription.oneose = () => {
      console.log("End of events for the default account.");

      if (tempNotes.length > 0) {
        // Deduplicate and merge tempNotes into loadedNotes
        loadedNotes = Array.from(
          new Map([...loadedNotes, ...tempNotes].map(note => [note.id, note])).values()
        );
        console.log("Deduplicated loadedNotes:", loadedNotes);

        // Sort loadedNotes by created_at in descending order
        loadedNotes.sort((a, b) => b.created_at - a.created_at);

        // Update lastSeenCreatedAt to the oldest note in tempNotes
        lastSeenCreatedAt = tempNotes[tempNotes.length - 1].created_at;
        console.log("Updated lastSeenCreatedAt to:", lastSeenCreatedAt);

        // Render only new notes
        tempNotes.forEach(note => displayNote(note));
      } else {
        console.log("No new notes fetched for default account.");
      }

      subscription.unsub?.();
      console.log("Finished fetching and rendering default account notes.");
    };
  } catch (error) {
    console.error("Error fetching default account notes:", error);
  }
}

async function fetchUserFeed(userPubKey, limit = 10) {
  console.log("Fetching user-specific feed...");

  const relay = new Relay(relayURL);
  try {
    await relay.connect();

    const filters = [{ kinds: [20], authors: [userPubKey], limit }];
    console.log("Filters for user feed:", filters);

    const subscription = relay.subscribe(filters, {});
    subscription.onevent = (event) => {
      if (!loadedNotes.some(note => note.id === event.id)) {
        loadedNotes.push(event);
        console.log("User note received:", event);
      }
    };

    subscription.oneose = () => {
      // Sort and render notes
      loadedNotes.sort((a, b) => b.created_at - a.created_at);
      renderNotes();
      subscription.unsub();
    };
  } catch (error) {
    console.error("Error fetching user-specific feed:", error);
  }
}

let lastSeenCreatedAt = Math.floor(Date.now() / 1000);
let loadedNotes = []; // Array to store all loaded notes
let isFetching = false;
async function fetchNotes(pubKey, limit = 10) {
  if (isFetching) return; // Prevent overlapping fetch calls
  isFetching = true;

  const relay = new Relay(relayURL);
  try {
    await relay.connect();

    const filters = [{ kinds: [20], until: lastSeenCreatedAt - 1, limit }];

    const tempNotes = []; // Temporary array for the current batch
    const subscription = relay.subscribe(filters, {});

    subscription.onevent = (event) => {

      // Add to tempNotes if not already present
      if (!tempNotes.some(note => note.id === event.id)) {
        tempNotes.push(event);
      } else {
      }
    };

    subscription.oneose = () => {

      if (tempNotes.length > 0) {
        // Deduplicate and merge tempNotes into loadedNotes
        loadedNotes = Array.from(
          new Map([...loadedNotes, ...tempNotes].map(note => [note.id, note])).values()
        );

        // Sort loadedNotes by created_at in descending order
        loadedNotes.sort((a, b) => b.created_at - a.created_at);

        // Update lastSeenCreatedAt to the oldest note in tempNotes
        lastSeenCreatedAt = tempNotes[tempNotes.length - 1].created_at;

        // Render only new notes
        tempNotes.forEach(note => displayNote(note));
      } else {
      }

      subscription.unsub();
    };
  } catch (error) {
    console.error("Error during relay connection or subscription:", error);
  }

  isFetching = false;
}

function renderNotes() {
  loadedNotes.forEach((note) => {
    if (!document.querySelector(`.note[data-note-id="${note.id}"]`)) {
      displayNote(note);
    } else {
    }
  });
}

let oldestNote = null;
// Update oldestNote whenever new notes are fetched
function updateOldestNote() {
  if (loadedNotes.length > 0) {
    const oldest = loadedNotes[loadedNotes.length - 1];
    oldestNote = oldest.created_at; // Use the `created_at` timestamp
  } else {
    console.warn("No notes found in loadedNotes to update oldestNote.");
    oldestNote = null;
  }
}

function setupInfiniteScroll() {
  window.addEventListener("scroll", async () => {
    const scrollPosition = window.scrollY + window.innerHeight; // Current scroll position plus viewport height
    const documentHeight = document.documentElement.scrollHeight; // Total document height

    // Check if user has scrolled to the bottom of the page
    if (scrollPosition >= documentHeight - 100) {
      if (!isFetching) {
        await fetchNotes(10); // Fetch the next 10 notes
      }
    }
  });
}

async function displayNote(note) {
  
  const notesSection = document.getElementById("notes");

  // Log the container
  if (!notesSection) {
    console.error("notesSection is missing. Ensure it exists in the DOM.");
    return;
  }

  // Create a container for the note
  const noteDiv = document.createElement("div");
  noteDiv.className = "note";
  noteDiv.dataset.createdAt = note.created_at;

  // Fetch profile metadata
  const pubkey = note.pubkey;
  const profile = await fetchProfile(pubkey);
  const { picture, displayName, nip05 } = profile;

  // Create the header section
  const headerDiv = document.createElement("div");
  headerDiv.className = "note-header";

  // Profile picture
  const profileImg = document.createElement("img");
  profileImg.src = picture || "default-profile.png"; // Fallback image if no picture
  profileImg.alt = `${displayName || pubkey}'s profile picture`;
  profileImg.className = "profile-pic";

  // Display name and NIP-05 container
  const nameContainer = document.createElement("div");
  nameContainer.className = "name-container";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = displayName || pubkey;
  nameSpan.className = "display-name";

  const nip05Span = document.createElement("span");
  nip05Span.textContent = nip05 ? `@${nip05}` : "";
  nip05Span.className = "nip05-status";
  if (nip05) nip05Span.style.color = "green"; // Indicate verified status with color

  nameContainer.appendChild(nameSpan);
  nameContainer.appendChild(nip05Span);

  // Container for profile and name
  const profileContainer = document.createElement("div");
  profileContainer.className = "profile-container";
  profileContainer.appendChild(profileImg);
  profileContainer.appendChild(nameContainer);

  // Date/time stamp
  const timestamp = new Date(note.created_at * 1000);
  const formattedTime = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
  const timeSpan = document.createElement("div");
  const [date, time] = formattedTime.split(", ");
  timeSpan.innerHTML = `<span class="timestamp-date">${date}</span><span class="timestamp-time">${time}</span>`;
  timeSpan.className = "timestamp";

  // Append elements to header
  headerDiv.appendChild(profileContainer);
  headerDiv.appendChild(timeSpan);
  noteDiv.appendChild(headerDiv);

  // Add the content text
  const contentDiv = document.createElement("p");
  contentDiv.textContent = note.content;
  noteDiv.appendChild(contentDiv);

  // Extract and display multiple images if the note has an imeta tag
  const imetaTags = note.tags.filter(tag => tag[0] === "imeta");
  const imageUrls = imetaTags
    .map(tag => {
      const urlEntry = tag.find(entry => entry.startsWith("url "));
      return urlEntry ? urlEntry.replace("url ", "") : null;
    })
    .filter(url => url !== null); // Remove any null values
    
    if (imageUrls.length > 0) {
      let currentIndex = 0;

      // Create a container for the image carousel
      const carouselDiv = document.createElement("div");
      carouselDiv.className = "image-carousel";

      // Create an image element
      const imgElement = document.createElement("img");
      imgElement.src = imageUrls[currentIndex];
      imgElement.alt = "Note image";
      imgElement.className = "note-image";
      carouselDiv.appendChild(imgElement);

      // Create left and right navigation buttons if there are multiple images
      if (imageUrls.length > 1) {
        const leftButton = document.createElement("button");
        leftButton.textContent = "◀"; // Left arrow
        leftButton.className = "carousel-button left-button";
        leftButton.onclick = () => {
          currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
          imgElement.src = imageUrls[currentIndex];
        };

        const rightButton = document.createElement("button");
        rightButton.textContent = "▶"; // Right arrow
        rightButton.className = "carousel-button right-button";
        rightButton.onclick = () => {
          currentIndex = (currentIndex + 1) % imageUrls.length;
          imgElement.src = imageUrls[currentIndex];
        };

        // Append buttons to the carousel
        carouselDiv.appendChild(leftButton);
        carouselDiv.appendChild(rightButton);
      }

      // Add swipe support for mobile
      let startX = 0;

      carouselDiv.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
      });

      carouselDiv.addEventListener("touchend", (e) => {
        const endX = e.changedTouches[0].clientX;
        if (startX - endX > 50) {
          // Swipe left
          currentIndex = (currentIndex + 1) % imageUrls.length;
        } else if (endX - startX > 50) {
          // Swipe right
          currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
        }
        imgElement.src = imageUrls[currentIndex];
      });

      // Append the carousel to the noteDiv
      noteDiv.appendChild(carouselDiv);
    }
  

  // Create a container for the like and repost buttons
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "note-actions";

  // Create the like button
  const likeButton = document.createElement("button");
  likeButton.innerHTML = "❤️";  //like button display emoji
  likeButton.className = "like-button";
  
  const reactionCount = document.createElement("span");
  reactionCount.className = "reaction-count";
  reactionCount.textContent = "0";

  likeButton.appendChild(reactionCount);
  likeButton.onclick = async () => {
    await reactToNote(note.id);
    reactionCount.textContent = parseInt(reactionCount.textContent) + 1;
  };

  // Add the button to the note
  noteDiv.appendChild(likeButton);

  // Append the note to the notes section
  notesSection.appendChild(noteDiv);

  // Fetch existing reactions for the note
  const relay = new Relay("wss://iajrgokkjnfq55gnuubol7kvvfd7luvfd3qpuuxf4pxtkl737vynzjad.local");
  await relay.connect();

  const sub = relay.subscribe([{ kinds: [7], "#e": [note.id] }], {});
  sub.onevent = (event) => {
    reactionCount.textContent = parseInt(reactionCount.textContent) + 1;
  };

  sub.oneose = () => {
    sub.unsub();
  };

  // Create the repost button
  const repostButton = document.createElement("button");
  repostButton.innerHTML = "🔄"; // Repost button icon (U+1F504)
  repostButton.className = "repost-button";

  const repostCount = document.createElement("span");
  repostCount.className = "repost-count";
  repostCount.textContent = "0";

  repostButton.appendChild(repostCount);
  repostButton.onclick = async () => {
    try {
      await repostNote(note.id);
      repostButton.classList.add("reposted");
      repostCount.textContent = parseInt(repostCount.textContent) + 1;
    } catch (error) {
      console.error("Error reposting note:", error);
      alert("Failed to repost. See console for details.");
    }
  };

  // Comment button
  const commentButton = document.createElement("button");
  commentButton.innerHTML = "💬"; // Comment button icon (U+1F4AC)
  commentButton.className = "comment-button";

  const commentCount = document.createElement("span");
  commentCount.className = "comment-count";
  commentCount.setAttribute("data-note-id", note.id);
  commentCount.textContent = "0";

  commentButton.appendChild(commentCount);
  commentButton.onclick = () => {
    openCommentPopup(note.id);
  };

  async function openCommentPopup(noteId) {
    
    // Create popup container
    const popupDiv = document.createElement("div");
    popupDiv.className = "comment-popup";
  
    // Create popup content container
    const popupContent = document.createElement("div");
    popupContent.className = "popup-content";
  
    // Create close button
    const closeButton = document.createElement("button");
    closeButton.textContent = "✖"; // Close button icon
    closeButton.className = "close-button";
    closeButton.onclick = () => popupDiv.remove();
  
    // Create comments section
    const commentsSection = document.createElement("div");
    commentsSection.className = "comments-section";

    // Create new comment form
    const commentForm = document.createElement("form");
    commentForm.className = "comment-form";
  
    const commentInput = document.createElement("textarea");
    commentInput.placeholder = "Write a comment...";
    commentInput.required = true;
  
    const submitButton = document.createElement("button");
    submitButton.textContent = "Post Comment";
    submitButton.type = "submit";
  
    commentForm.appendChild(commentInput);
    commentForm.appendChild(submitButton);
  
    // Handle form submission
    commentForm.onsubmit = async (e) => {
        e.preventDefault();
        const content = commentInput.value.trim();
        if (content) {
            await postComment(noteId, content);
            commentInput.value = "";
            fetchComments(noteId, commentsSection); // Refresh comments after posting
        }
    };
  
    // Append elements to the popup
    popupContent.appendChild(closeButton);
    popupContent.appendChild(commentsSection);
    popupContent.appendChild(commentForm);
    popupDiv.appendChild(popupContent);
  
    // Add popup to the body
    document.body.appendChild(popupDiv);

    // Initialize relay and connect with retry logic
    const relay = new Relay(relayURL);
    try {
        await connectWithRetry(relay); // Ensure relay connection

        // Subscribe to comments for the given note ID
        const sub = relay.subscribe([{ kinds: [1], "#e": [noteId] }], {});

        // Fetch and display existing comments for the note
        sub.onevent = async (event) => {
            // Check if the comment is already displayed to avoid duplicates
            if (!document.getElementById(`comment-${event.id}`)) {
                const profile = await fetchProfile(event.pubkey);
                displayComment(event, profile, commentsSection);
            }
        };

        sub.oneose = () => {
            sub.unsub();
        };
    } catch (error) {
        console.error("Failed to connect or subscribe to relay:", error);
    }
}

  //Zap button
  const zapButton = document.createElement("button");
  zapButton.innerHTML = "⚡"; // Zap button icon
  zapButton.className = "zap-button";

  const zapCount = document.createElement("span");
  zapCount.className = "zap-count";
  zapCount.textContent = "0"; // Default zap count

  zapButton.appendChild(zapCount);
  
  async function fetchLightningAddress(pubkey) {
    try {
      const relay = new Relay(relayURL);
      await relay.connect();
  
      const sub = relay.subscribe([{ kinds: [0], authors: [pubkey] }], {});
      return new Promise((resolve, reject) => {
        sub.onevent = (event) => {
          const profile = JSON.parse(event.content);
          const lightningAddress = profile.lud16 || atob(profile.lud06 || "");
          if (lightningAddress) {
            resolve(lightningAddress);
          } else {
            reject("No Lightning Address found in profile.");
          }
          sub.unsub();
        };
        sub.oneose = () => {
          reject("Profile not found or incomplete.");
          sub.unsub();
        };
      });
    } catch (error) {
      console.error("Error fetching Lightning Address:", error);
      throw error;
    }
  }

  zapButton.onclick = async () => {
    const zapAmount = 21; // Hard-coded zap amount in sats
  
    try {
      const pubkey = await window.nostr.getPublicKey();
      const lightningAddress = await fetchLightningAddress(note.pubkey);
  
      // Construct LNURL
      const lnurl = `https://${lightningAddress.split("@")[1]}/.well-known/lnurlp/${lightningAddress.split("@")[0]}`;
      console.log("LNURL for zapping:", lnurl);
  
      // Fetch zap invoice
      const zapResponse = await fetch(lnurl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: zapAmount * 1000, // Convert sats to msats
          nostr: JSON.stringify({
            kind: 9735,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["e", note.id],
              ["p", note.pubkey],
              ["amount", zapAmount.toString()],
              ["lnurl", lightningAddress],
            ],
            content: "Zap via Pippin",
            pubkey,
          }),
        }),
      });
  
      const zapData = await zapResponse.json();
      if (!zapData.pr) {
        throw new Error("No payment request (invoice) returned from LNURL.");
      }
  
      // Prompt user to pay the invoice with their Lightning wallet
      alert(`Zap Invoice:\n\n${zapData.pr}\n\nCopy this invoice to your Lightning wallet to complete the zap.`);
      console.log("Zap Invoice:", zapData.pr);
    } catch (error) {
      console.error("Error zapping note via NWC:", error);
      alert("Failed to zap note. See console for details.");
    }
  };

  // Append the buttons to the actions container
  actionsDiv.appendChild(likeButton);
  actionsDiv.appendChild(repostButton);
  actionsDiv.appendChild(commentButton);
  actionsDiv.appendChild(zapButton);

  // Add the actions container to the note
  noteDiv.appendChild(actionsDiv);

  // Fetch existing reposts for the note
  const repostSub = relay.subscribe([{ kinds: [6], "#e": [note.id] }], {}); // Kind 6 for reposts
  repostSub.onevent = (event) => {
    repostCount.textContent = parseInt(repostCount.textContent) + 1;
  };
  repostSub.oneose = () => {
    repostSub.unsub();
  };

  const zapRelay = new Relay(relayURL);
  await zapRelay.connect();

  const zapSub = zapRelay.subscribe([{ kinds: [9735], "#e": [note.id] }], {});
  zapSub.onevent = (event) => {
    const amountTag = event.tags.find((tag) => tag[0] === "amount");
    if (amountTag) {
      zapCount.textContent =
        parseInt(zapCount.textContent) + parseInt(amountTag[1]);
    }
  };

  zapSub.oneose = () => {
    zapSub.unsub();
  };
}

function displayComment(comment, profile, commentSection) {
  const commentDiv = document.createElement("div");
  commentDiv.className = "comment";

  // Create profile image
  const profileImg = document.createElement("img");
  profileImg.src = profile.picture || "default-profile.png"; // Fallback image
  profileImg.alt = `${profile.displayName || comment.pubkey}'s profile picture`;
  profileImg.className = "comment-profile-pic";

  // Create display name span
  const nameSpan = document.createElement("span");
  nameSpan.textContent = profile.displayName || comment.pubkey;
  nameSpan.className = "comment-display-name";

  // Create content text
  const contentDiv = document.createElement("p");
  contentDiv.textContent = comment.content;
  contentDiv.className = "comment-content";

  // Create buttons container
  const buttonsDiv = document.createElement("div");
  buttonsDiv.className = "comment-buttons";

  // Like button
  const likeButton = document.createElement("button");
  likeButton.innerHTML = "❤️"; // Like button emoji
  likeButton.className = "comment-like-button";
  const likeCount = document.createElement("span");
  likeCount.className = "like-count";
  likeCount.textContent = "0";
  likeButton.appendChild(likeCount);

  likeButton.onclick = async () => {
    await reactToComment(comment.id);
    likeCount.textContent = parseInt(likeCount.textContent) + 1;
  };

  // Comment button
  const commentButton = document.createElement("button");
  commentButton.innerHTML = "💬"; // Comment button emoji
  commentButton.className = "comment-reply-button";
  const commentCount = document.createElement("span");
  commentCount.className = "comment-count";
  commentCount.textContent = "0";
  commentButton.appendChild(commentCount);

  commentButton.onclick = () => openCommentPopup(comment.id);

  // Zap button
  const zapButton = document.createElement("button");
  zapButton.innerHTML = "⚡"; // Zap button emoji
  zapButton.className = "comment-zap-button";
  const zapCount = document.createElement("span");
  zapCount.className = "zap-count";
  zapCount.textContent = "0";
  zapButton.appendChild(zapCount);

  zapButton.onclick = async () => {
    await zapComment(comment.id);
    zapCount.textContent = parseInt(zapCount.textContent) + zapAmount;
  };

  // Append buttons to buttonsDiv
  buttonsDiv.appendChild(likeButton);
  buttonsDiv.appendChild(commentButton);
  buttonsDiv.appendChild(zapButton);

  // Append elements to commentDiv
  commentDiv.appendChild(profileImg);
  commentDiv.appendChild(nameSpan);
  commentDiv.appendChild(contentDiv);
  commentDiv.appendChild(buttonsDiv);

  // Append commentDiv to the comment section
  commentSection.appendChild(commentDiv);
}

async function fetchProfile(pubkey) {
  const relay = new Relay(relayURL);
  await relay.connect();

  return new Promise((resolve, reject) => {
    const sub = relay.subscribe([{ kinds: [0], authors: [pubkey] }], {});
    sub.onevent = (event) => {
      const metadata = JSON.parse(event.content);
      resolve({
        picture: metadata.picture || null,
        displayName: metadata.display_name || metadata.name || pubkey,
        nip05: metadata.nip05 || null,
      });
      sub.unsub();
    };

    sub.oneose = () => {
      resolve({
        picture: null,
        displayName: pubkey,
        nip05: null,
      });
      sub.unsub();
    };

    sub.onfailed = (reason) => {
      console.error("Subscription failed:", reason);
      reject(reason);
    };
  });
}

async function reactToNote(noteId) {
  if (!window.nostr) {
    alert("NIP-07 signing extension not found!");
    return;
  }

  try {
    const pubkey = await window.nostr.getPublicKey();
    const event = {
      kind: 7,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["e", noteId], ["p", pubkey]],
      content: "❤️", // like button emoji actually sent
      pubkey,
    };

    event.id = getEventHash(event);
    event.sig = await window.nostr.signEvent(event);

    const relay = new Relay(relayURL);
    await relay.connect();
    const pub = relay.publish(event);
    pub.on("ok", () => {
    });
    pub.on("failed", reason => {
      console.error("Failed to publish reaction event:", reason);
    });
  } catch (error) {
    console.error("Error reacting to note:", error);
  }
}

async function repostNote(noteId) {
  if (!window.nostr) {
    alert("NIP-07 signing extension not found!");
    return;
  }

  try {
    const pubkey = await window.nostr.getPublicKey();
    const event = {
      kind: 6, // Kind 6 for reposts
      created_at: Math.floor(Date.now() / 1000),
      tags: [["e", noteId], ["p", pubkey]],
      content: "", // Empty content as per NIP-18
      pubkey,
    };

    event.id = getEventHash(event);
    event.sig = await window.nostr.signEvent(event);

    const relay = new Relay(relayURL);
    await relay.connect();
    const pub = relay.publish(event);

    pub.on("ok", () => {
      console.log("Repost event published successfully");
    });

    pub.on("failed", (reason) => {
      console.error("Failed to publish repost event:", reason);
    });
  } catch (error) {
    console.error("Error reposting note:", error);
  }
}

async function fetchComments(noteId, commentsSection) {
  commentsSection.innerHTML = "<p>Loading comments...</p>";

  try {
    const relay = new Relay(relayURL);
    await relay.connect().then(() => {
    }).catch((error) => {
      console.error("Failed to connect to relay:", error);
    });

    console.log("Note ID for comment subscription:", noteId);
    const sub = relay.subscribe([{ kinds: [1], "#e": [noteId] }], {}); // Kind 1 with e-tag matching note ID
    console.log("Subscription created:", sub);
    commentsSection.innerHTML = ""; // Clear loading message

    sub.onevent = (event) => {
      if (event.kind === 1) { // Check if it's a comment event
        const noteId = event.tags.find(tag => tag[0] === "e")[1]; // Get note ID from tags
        updateCommentCount(noteId, parseInt(document.querySelector(`.comment-count[data-note-id="${noteId}"]`)?.textContent || 0) + 1);
      }
      
      const commentDiv = document.createElement("div");
      commentDiv.className = "comment";

      const contentP = document.createElement("p");
      contentP.textContent = event.content;
      commentDiv.appendChild(contentP);

      // Add like, comment, and zap buttons for each comment
      addCommentActions(commentDiv, event);

      commentsSection.appendChild(commentDiv);
    };

    sub.oneose = () => sub.unsub();
    
    setTimeout(() => {
      if (commentSection.children.length === 0) {
        commentSection.innerHTML = "<p>No comments found.</p>";
      }
    }, 3000);
    
  } catch (error) {
    console.error("Error fetching comments:", error);
    commentsSection.innerHTML = "<p>Failed to load comments.</p>";
  }
}

async function postComment(noteId, content) {
  if (!window.nostr) {
    alert("NIP-07 signing extension not found!");
    return;
  }

  try {
    const pubkey = await window.nostr.getPublicKey();
    const event = {
      kind: 1, // Kind 1 for regular notes (comments are notes with an e-tag)
      created_at: Math.floor(Date.now() / 1000),
      tags: [["e", noteId]], // Link the comment to the original note
      content: content,
      pubkey,
    };

    event.id = getEventHash(event);
    const signedEvent = await window.nostr.signEvent(event);
    event.sig = signedEvent.sig; // Extract only the signature string

    const relay = new Relay(relayURL);
    await relay.connect();
    relay.publish(event)
      .then(() => {
        console.log("Comment published successfully.");
      })
      .catch((reason) => {
        console.error("Failed to publish comment:", reason);
      });
  } catch (error) {
    console.error("Error posting comment:", error);
    alert("Failed to post comment. See console for details.");
  }
}

function addCommentActions(commentDiv, event) {
  // Like button
  const likeButton = document.createElement("button");
  likeButton.innerHTML = "❤️";
  likeButton.onclick = async () => {
    await reactToNote(event.id);
    // Increment like count if needed
  };

  // Comment button (for replying to comments)
  const replyButton = document.createElement("button");
  replyButton.innerHTML = "💬";
  replyButton.onclick = () => openCommentPopup(event.id); // Open reply popup

  // Zap button
  const zapButton = document.createElement("button");
  zapButton.innerHTML = "⚡";
  zapButton.onclick = async () => {
    await zapNote(event.id);
    // Increment zap count if needed
  };

  // Append actions to the comment
  commentDiv.appendChild(likeButton);
  commentDiv.appendChild(replyButton);
  commentDiv.appendChild(zapButton);
}

async function connectWithRetry(relay, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await relay.connect();
      return; // Exit function if connection is successful
    } catch (error) {
      console.error(`Relay connection attempt ${attempt} failed:`, error);
      if (attempt < maxRetries) {
        await new Promise(res => setTimeout(res, delay)); // Wait before retrying
      } else {
        alert("Failed to connect to relay after multiple attempts.");
        throw error; // Throw error if all attempts fail
      }
    }
  }
}

async function reactToComment(commentId) {
  if (!window.nostr) {
    alert("NIP-07 signing extension not found!");
    return;
  }

  try {
    const pubkey = await window.nostr.getPublicKey();
    const event = {
      kind: 7,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["e", commentId], ["p", pubkey]],
      content: "❤️", // Like emoji
      pubkey,
    };

    event.id = getEventHash(event);
    event.sig = await window.nostr.signEvent(event);

    const relay = new Relay(relayURL);
    await relay.connect();
    relay.publish(event);
    console.log("Reaction event published:", event);
  } catch (error) {
    console.error("Error reacting to comment:", error);
  }
}

async function zapComment(commentId) {
  if (!window.nostr) {
    alert("NIP-07 signing extension not found!");
    return;
  }

  try {
    const pubkey = await window.nostr.getPublicKey();
    const event = {
      kind: 9735,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["e", commentId], ["p", pubkey]],
      content: `${zapAmount} sats zap`,
      pubkey,
    };

    event.id = getEventHash(event);
    event.sig = await window.nostr.signEvent(event);

    const relay = new Relay(relayURL);
    await relay.connect();
    relay.publish(event);
    console.log("Zap event published:", event);
  } catch (error) {
    console.error("Error zapping comment:", error);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeClient();
  await fetchNotes(10).then(() => {
    updateOldestNote();
  });
  setupInfiniteScroll(); // Set up infinite scroll for dynamic loading
});

fetchNotes();