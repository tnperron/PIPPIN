import * as nostrTools from "nostr-tools";
const { Relay, getEventHash } = nostrTools;
import { decode } from "bech32";
let globalRelay;
let globalReactionSub;
let globalRepostSub;
let globalZapSub;

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

    if (!window.nostr) {
      throw new Error("NIP-07 signing extension not found.");
    }

    const pubkey = await window.nostr.getPublicKey();
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

    authEvent.id = getEventHash(authEvent);

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
    console.log("User signed in. Displaying user's feed.");
    fetchUserFeed(userPubKey);
  }
}

async function fetchDefaultNotes() {
  console.log("Fetching notes for the default account...");

    console.log("Relay connected for default account.");

    const filters = [{ kinds: [20], authors: [defaultPubKey], until: lastSeenCreatedAt - 1, limit: 10 }];

    const tempNotes = [];
    const subscription = globalRelay.subscribe(filters, {
      onevent: (event) => {
        if (!tempNotes.some(note => note.id === event.id)) {
          tempNotes.push(event);
        } else {
          console.log("Duplicate note skipped in tempNotes:", event.id);
        }
      },
      oneose: async () => {
        if (tempNotes.length > 0) {
          loadedNotes = Array.from(
            new Map([...loadedNotes, ...tempNotes].map(note => [note.id, note])).values()
          );
          loadedNotes.forEach(note => {
            note.created_at = parseInt(note.created_at, 10);
          });
          loadedNotes.sort((a, b) => b.created_at - a.created_at);
          tempNotes.sort((a, b) => b.created_at - a.created_at);
          lastSeenCreatedAt = tempNotes[0].created_at;
          await Promise.all(tempNotes.map(note => displayNote(note)));
          sortNotesInDOM();
          updateGlobalSubscriptions();
        } else {
          console.log("No new notes fetched for default account.");
          sortNotesInDOM();
        }
        console.log("Finished fetching and rendering default account notes.");
      }
    });
}

async function fetchUserFeed() {
  console.log("Fetching user-specific feed...");
    //TODO: Fetch NIP-02 follow list for authors filter.
    const filters = [{ kinds: [20], authors: [defaultPubKey], until: lastSeenCreatedAt - 1, limit: 10 }];
    console.log("Filters for user feed:", filters);

    const tempNotes = [];
    const subscription = globalRelay.subscribe(filters, {
      onevent: (event) => {
        if (!tempNotes.some(note => note.id === event.id)) {
          tempNotes.push(event);
        } else {
          console.log("Duplicate note skipped in tempNotes:", event.id);
        }
      },
      oneose: async () => {
        if (tempNotes.length > 0) {
          loadedNotes = Array.from(
            new Map([...loadedNotes, ...tempNotes].map(note => [note.id, note])).values()
          );
          loadedNotes.forEach(note => {
            note.created_at = parseInt(note.created_at, 10);
          });
          loadedNotes.sort((a, b) => b.created_at - a.created_at);
          tempNotes.sort((a, b) => b.created_at - a.created_at);
          lastSeenCreatedAt = tempNotes[0].created_at;
          await Promise.all(tempNotes.map(note => displayNote(note)));
          sortNotesInDOM();
          updateGlobalSubscriptions();
        } else {
          console.log("No new notes fetched for user feed.");
          sortNotesInDOM();
        }
        console.log("Finished fetching and rendering user feed notes.");
      }
    });
}

let lastSeenCreatedAt = Math.floor(Date.now() / 1000);
let loadedNotes = [];
let isFetching = false;
async function fetchNotes(pubKey, limit = 10) {
  if (isFetching) return;
  isFetching = true;

    const filters = [{ kinds: [20], until: lastSeenCreatedAt - 1, limit }];

    const tempNotes = [];
    const subscription = globalRelay.subscribe(filters, {});

    subscription.onevent = (event) => {

      // Add to tempNotes if not already present
      if (!tempNotes.some(note => note.id === event.id)) {
        tempNotes.push(event);
      } else {
      }
    };

    subscription.oneose = async() => {

      if (tempNotes.length > 0) {
        // Deduplicate and merge tempNotes into loadedNotes
        loadedNotes = Array.from(
          new Map([...loadedNotes, ...tempNotes].map(note => [note.id, note])).values()
        );
        
        // Check if loadedNotes is a number
        loadedNotes.forEach(note => console.log(note.created_at, typeof note.created_at));
        
        // Make sure created_at is a number and not a string
        loadedNotes.forEach(note => {
          note.created_at = parseInt(note.created_at, 10);
        });
        
        // Sort loadedNotes by created_at in descending order
        loadedNotes.sort((a, b) => b.created_at - a.created_at);

        // Update lastSeenCreatedAt to the oldest note in tempNotes
        tempNotes.sort((a, b) => b.created_at - a.created_at);
        lastSeenCreatedAt = tempNotes[0].created_at;

        // Render only new notes
        await Promise.all(tempNotes.map(note => displayNote(note)));

        // Sort the notes in the DOM
        sortNotesInDOM();

        updateGlobalSubscriptions();  // Refresh the global subscriptions with new note IDs.
      } else {
      }

      subscription.close();
    };

  isFetching = false;
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

function displayNote(note) {
  
  // Ensure created_at is a number.
  note.created_at = parseInt(note.created_at, 10);

  // Synchronously create a basic container for the note.
  const notesSection = document.getElementById("notes");
  const noteDiv = document.createElement("div");
  noteDiv.className = "note";
  
  // Save the note’s creation time and ID as data attributes.
  noteDiv.dataset.createdAt = note.created_at;
  noteDiv.dataset.noteId = note.id;

  // Synchronously add the timestamp and content.
  const headerDiv = document.createElement("div");
  headerDiv.className = "note-header";
  headerDiv.textContent = new Date(note.created_at * 1000).toLocaleString();
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
  actionsDiv.appendChild(likeButton);

  // Append the note to the notes section
  notesSection.appendChild(noteDiv);

  // Now, kick off asynchronous updates.
  updateNoteDetails(note, noteDiv);

  // Create the repost button
  const repostButton = document.createElement("button");
  repostButton.innerHTML = "🔄"; // Repost button icon (U+1F504)
  repostButton.className = "repost-button";

  const repostCount = document.createElement("span");
  repostCount.className = "repost-count";
  repostCount.textContent = "0";
  repostButton.appendChild(repostCount);
  actionsDiv.appendChild(repostButton);
  
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
  actionsDiv.appendChild(commentButton);
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

        // Subscribe to comments for the given note ID
        const sub = globalRelay.subscribe([{ kinds: [1], "#e": [noteId] }], {});

        // Fetch and display existing comments for the note
        sub.on("event", async (event) => {
            // Check if the comment is already displayed to avoid duplicates
            if (!document.getElementById(`comment-${event.id}`)) {
                const profile = await fetchProfile(event.pubkey);
                displayComment(event, profile, commentsSection);
            }
        });

        sub.on("eose", () => {
            sub.close();
        });
}

  //Zap button
  const zapButton = document.createElement("button");
  zapButton.innerHTML = "⚡"; // Zap button icon
  zapButton.className = "zap-button";

  const zapCount = document.createElement("span");
  zapCount.className = "zap-count";
  zapCount.textContent = "0"; // Default zap count

  zapButton.appendChild(zapCount);
  actionsDiv.appendChild(zapButton);
  
  async function fetchLightningAddress(pubkey) {
  
      const sub = globalRelay.subscribe([{ kinds: [0], authors: [pubkey] }], {});
      return new Promise((resolve, reject) => {
        sub.on("event", (event) => {
          const profile = JSON.parse(event.content);
          const lightningAddress = profile.lud16 || atob(profile.lud06 || "");
          if (lightningAddress) {
            resolve(lightningAddress);
          } else {
            reject("No Lightning Address found in profile.");
          }
          sub.close();
        });
        sub.on("eose", () => {
          reject("Profile not found or incomplete.");
          sub.close();
        });
      });
    }

  zapButton.onclick = async () => {
    const zapAmount = zapAmount;
  
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

  // Add the actions container to the note
  noteDiv.appendChild(actionsDiv);

  // Fetch existing reposts for the note
  const repostSub = globalRelay.subscribe([{ kinds: [6], "#e": [note.id] }], {
    onEvent: (event) => {
      repostCount.textContent = parseInt(repostCount.textContent) + 1;
    },
    onEose: () => {
      repostSub.unsubscribe();
    }
  });
}

function updateGlobalReactionSubscription() {
  // Get the list of note IDs from your global loadedNotes array.
  const noteIds = loadedNotes.map(note => note.id);
  
  // Unsubscribe from the previous reaction subscription, if it exists.
  if (globalReactionSub && typeof globalReactionSub.unsubscribe === "function") {
    globalReactionSub.unsubscribe();
  }
  
  // Create a filter for kind 7 events that mention any of these note IDs.
  const filters = [{ kinds: [7], "#e": noteIds }];
  
  // Create the subscription using the global relay.
  globalReactionSub = globalRelay.subscribe(filters, {
    onEvent: (event) => {
      // Extract the note ID from the event's e-tag.
      const noteIdTag = event.tags.find(tag => tag[0] === "e");
      if (!noteIdTag) return;
      const noteId = noteIdTag[1];

      // Find the corresponding note element in the DOM.
      const noteDiv = document.querySelector(`.note[data-note-id="${noteId}"]`);
      if (noteDiv) {
        const reactionSpan = noteDiv.querySelector(".reaction-count");
        if (reactionSpan) {
          // Increment the reaction count.
          reactionSpan.textContent = parseInt(reactionSpan.textContent) + 1;
        }
      }
    },
    onEose: () => {
      console.log("globalReactionSub received eose");
    }
  });
}

function updateGlobalRepostSubscription() {
  const noteIds = loadedNotes.map(note => note.id);
  if (globalRepostSub && typeof globalRepostSub.unsubscribe === "function") {
    globalRepostSub.unsubscribe();
  }
  
  const filters = [{ kinds: [6], "#e": noteIds }];
  globalRepostSub = globalRelay.subscribe(filters, {
    onEvent: (event) => {
      const noteIdTag = event.tags.find(tag => tag[0] === "e");
      if (!noteIdTag) return;
      const noteId = noteIdTag[1];
      
      const noteDiv = document.querySelector(`.note[data-note-id="${noteId}"]`);
      if (noteDiv) {
        const repostSpan = noteDiv.querySelector(".repost-count");
        if (repostSpan) {
          repostSpan.textContent = parseInt(repostSpan.textContent) + 1;
        }
      }
    },
    onEose: () => {
      console.log("globalRepostSub received eose");
    }
  });
}

function updateGlobalZapSubscription() {
  const noteIds = loadedNotes.map(note => note.id);
  if (globalZapSub && typeof globalZapSub.unsubscribe === "function") {
    globalZapSub.unsubscribe();
  }
  
  const filters = [{ kinds: [9735], "#e": noteIds }];
  globalZapSub = globalRelay.subscribe(filters, {
    onEvent: (event) => {
      const noteIdTag = event.tags.find(tag => tag[0] === "e");
      if (!noteIdTag) return;
      const noteId = noteIdTag[1];
      
      const noteDiv = document.querySelector(`.note[data-note-id="${noteId}"]`);
      if (noteDiv) {
        const zapSpan = noteDiv.querySelector(".zap-count");
        if (zapSpan) {
          zapSpan.textContent = parseInt(zapSpan.textContent) + 1;
        }
      }
    },
    onEose: () => {
      console.log("globalZapSub received eose");
    }
  });
}

function updateGlobalSubscriptions() {
  updateGlobalReactionSubscription();
  updateGlobalRepostSubscription();
  updateGlobalZapSubscription();
}

async function updateNoteDetails(note, noteDiv) {
  const pubkey = note.pubkey;
  try {
    const profile = await fetchProfile(pubkey);
    const { picture, displayName, nip05 } = profile;

    // Now update the header with profile details.
    const headerDiv = noteDiv.querySelector(".note-header");
    headerDiv.innerHTML = ""; // Remove the placeholder text

    // Create profile image.
    const profileImg = document.createElement("img");
    profileImg.src = picture || "default-profile.png";
    profileImg.alt = `${displayName || pubkey}'s profile picture`;
    profileImg.className = "profile-pic";

    // Create container for display name and verified status.
    const nameContainer = document.createElement("div");
    nameContainer.className = "name-container";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = displayName || pubkey;
    nameSpan.className = "display-name";

    const nip05Span = document.createElement("span");
    nip05Span.textContent = nip05 ? `@${nip05}` : "";
    nip05Span.className = "nip05-status";
    if (nip05) nip05Span.style.color = "green";

    nameContainer.appendChild(nameSpan);
    nameContainer.appendChild(nip05Span);

    // Combine profile info.
    const profileContainer = document.createElement("div");
    profileContainer.className = "profile-container";
    profileContainer.appendChild(profileImg);
    profileContainer.appendChild(nameContainer);

    // Create a detailed timestamp if desired.
    const detailedTimestamp = document.createElement("div");
    detailedTimestamp.className = "timestamp";
    const formattedTime = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(note.created_at * 1000));
    detailedTimestamp.textContent = formattedTime;

    // Append the new details.
    headerDiv.appendChild(profileContainer);
    headerDiv.appendChild(detailedTimestamp);
  } catch (error) {
    console.error("Error updating note details:", error);
  }
}

function sortNotesInDOM() {
  const notesSection = document.getElementById("notes"); // Select the notes section
  const notesArray = Array.from(notesSection.children); // Convert children to an array

  // Sort based on the numeric value of data-created-at (newest first)
  notesArray.sort((a, b) => parseInt(b.dataset.createdAt, 10) - parseInt(a.dataset.createdAt, 10));

  // Clear and re-append the sorted notes
  notesSection.innerHTML = ""; // Clear the section
  notesArray.forEach(note => notesSection.appendChild(note)); // Append sorted notes
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

const profileCache = new Map();
async function fetchProfile(pubkey) {
  if (profileCache.has(pubkey)) {
    return profileCache.get(pubkey);
  }
  return new Promise((resolve, reject) => {
    const sub = globalRelay.subscribe(
      [{ kinds: [0], authors: [pubkey] }],
      {
        onevent: (event) => {
          try {
            const metadata = JSON.parse(event.content);
            const profile = {
              picture: metadata.picture || null,
              displayName: metadata.display_name || metadata.name || pubkey,
              nip05: metadata.nip05 || null,
            };
            profileCache.set(pubkey, profile);
            resolve(profile);
          } catch (err) {
            reject(err);
          }
        },
        oneose: () => {
          // If no event is received, resolve with defaults.
          const profile = {
            picture: null,
            displayName: pubkey,
            nip05: null,
          };
          profileCache.set(pubkey, profile);
          resolve(profile);
        },
        onerror: (err) => {
          console.error("Profile subscription failed:", err);
          reject(err);
        }
      }
    );
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
      kind: 6,
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

    console.log("Note ID for comment subscription:", noteId);
    const sub = globalRelay.subscribe([{ kinds: [1], "#e": [noteId] }], {}); // Kind 1 with e-tag matching note ID
    console.log("Subscription created:", sub);
    commentsSection.innerHTML = ""; // Clear loading message

    sub.on("event", (event) => {
      if (event.kind === 1) { // Check if it's a comment event
        const noteId = event.tags.find(tag => tag[0] === "e")[1]; // Get note ID from tags
        updateCommentCount(noteId, parseInt(document.querySelector(`.comment-count[data-note-id="${noteId}"]`)?.textContent || 0) + 1);
      }
      
      // Immediately unsubscribe after receiving data.
      if (typeof sub.unsubscribe === "function") sub.unsubscribe();

      const commentDiv = document.createElement("div");
      commentDiv.className = "comment";

      const contentP = document.createElement("p");
      contentP.textContent = event.content;
      commentDiv.appendChild(contentP);

      // Add like, comment, and zap buttons for each comment
      addCommentActions(commentDiv, event);

      commentsSection.appendChild(commentDiv);
    });

    sub.on("eose", () => {
    
    setTimeout(() => {
      if (commentSection.children.length === 0) {
        commentSection.innerHTML = "<p>No comments found.</p>";
      }
      }, 3000)
    });
    if (typeof sub.unsubscribe === "function") sub.unsubscribe();

  sub.on("failed", (reason) => {
    console.error("Subscription failed:", reason);
    reject(reason);
  });
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
  console.log("Page loaded. Initializing client...");
  
  // Create and connect the global relay instance
  globalRelay = new Relay(relayURL);
  try {
    await globalRelay.connect();
    console.log("Global relay connected successfully.");
  } catch (error) {
    console.error("Failed to connect global relay:", error);
  }

  // Initialize the client and determine the starting feed
  await initializeClient();

  // Set up infinite scroll after initializing the feed
  setupInfiniteScroll();
});