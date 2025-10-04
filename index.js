import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js';
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  orderByKey,
  query,
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js';

// Constants
const TOKEN_KEY = 'replicateApiToken';
const REPLICATE_PROXY =
  'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
const SEEDREAM_MODEL = 'bytedance/seedream-4';

// Hardcoded Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyB3NIp4zg94-XxVOUkdnl-w1oYZ_Qo32Lw',
  authDomain: 'pipipip-c1210.firebaseapp.com',
  databaseURL: 'https://pipipip-c1210-default-rtdb.firebaseio.com/',
  projectId: 'pipipip-c1210',
  messagingSenderId: '431347949307',
  appId: '1:431347949307:web:a83ba36b06e6db73041a5e',
  measurementId: 'G-4HP4GMTH2W',
};

// Global state
let firebaseApp = null;
let database = null;
let imageCache = new Map();
let currentImages = [];
let currentImgIdx = -1;
let wikiImages = [];

// Utility functions
const $ = (id) => document.getElementById(id);
const cursorEl = document.createElement('div');
cursorEl.style.position = 'fixed';
cursorEl.style.width = '1px';
cursorEl.style.height = '100dvh';
cursorEl.style.backgroundColor = 'blue';
cursorEl.style.opacity = '0.5';
cursorEl.style.pointerEvents = 'none';
document.body.appendChild(cursorEl);

function showLoading(message = 'Processing...') {
  const loadingEl = $('loading');
  const loadingText = $('loadingText');
  if (loadingText) loadingText.textContent = message;
  if (loadingEl) loadingEl.style.display = 'flex';
  document.body.style.cursor = 'wait';
}

function hideLoading() {
  const loadingEl = $('loading');
  const loadingText = $('loadingText');
  if (loadingText) loadingText.textContent = '';
  if (loadingEl) loadingEl.style.display = 'none';
  document.body.style.cursor = 'default';
}

function showStatus(message, type = 'success') {
  const status = $('status');
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3000);
}

function maskToken(token) {
  if (!token) return '(none)';
  if (token.length <= 8) return '*'.repeat(token.length);
  return token.slice(0, 4) + '...' + token.slice(-4);
}

function renderTokenStatus() {
  const token = localStorage.getItem(TOKEN_KEY);
  const el = $('tokenStatus');
  if (el)
    el.textContent = token ? `Saved: ${maskToken(token)}` : 'No token saved';
}

// Convert file to base64 data URL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Convert image URL to base64 (for external URLs from Replicate)
async function urlToDataURL(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting URL to data URL:', error);
    return url; // Return original URL if conversion fails
  }
}

// Initialize Firebase
function initializeFirebase() {
  try {
    console.log('Initializing Firebase with hardcoded config...');
    firebaseApp = initializeApp(firebaseConfig);
    database = getDatabase(firebaseApp);

    showStatus('Firebase initialized successfully!');
    loadTimeline();

    // Enable upload button
    const uploadBtn = $('uploadImage');
    if (uploadBtn) {
      uploadBtn.disabled = false;
    }

    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    showStatus('Firebase initialization failed: ' + error.message, 'error');
    return false;
  }
}

// Load existing timeline from Firebase
async function loadTimeline() {
  try {
    const imagesRef = ref(database, 'images');
    const snapshot = await get(imagesRef);
    const images = snapshot.val() || {};

    currentImages = Object.keys(images)
      .map((key) => ({
        id: key,
        ...images[key],
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    renderTimeline();
  } catch (error) {
    console.error('Error loading timeline:', error);
    showStatus('Error loading timeline: ' + error.message, 'error');
  }
}

// Render timeline UI
function renderTimeline() {
  const timeline = $('timeline');
  console.log('Timeline element:', timeline); // Debug log

  if (currentImages.length === 0) {
    console.log('No images, showing upload interface'); // Debug log
  } else {
    const timelineImgs = currentImages
      .map(
        (img, index) =>
          `
      <div class="image-item" data-index="${index}">
        <img src="${img.dataURL}" alt="Image ${index + 1}" loading="lazy">
        <div class="image-info">
       ${img.title} ${index !== currentImages.length - 1 ? '->' : ''}
        </div>
      </div>
    `,
      )
      .join('');

    // Use innerHTML to set all content at once (images + upload interface)
    timeline.innerHTML = timelineImgs;
  }

  // Logic to click the image and open in #viewer
  const imageItems = document.querySelectorAll('.image-item');
  imageItems.forEach((item) => {
    item.addEventListener('click', () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        // update the currentImgIdx
        currentImgIdx = imgData.idx;
        console.log('🔔 Clicked image index:', currentImgIdx);

        renderImageInViewer(imgData);
      }
    });
  });
}

// #viewer div render function
const img = $('mainImage');
const bbox = $('bbox');
function renderImageInViewer(imgData) {
  // load image
  img.src = imgData.dataURL;

  // update current image
  currentImgIdx = imgData.idx;

  // if placement exists, draw bbox
  if (imgData.placement) {
    const p = imgData.placement;
    bbox.style.display = 'block';
    bbox.style.left = p.x + '%';
    bbox.style.top = p.y + '%';
    bbox.style.width = p.width + '%';
    bbox.style.height = p.height + '%';
    bbox.style.opacity = '0.9';
    bbox.style.backdropFilter = 'blur(4px)';
  } else {
    bbox.style.display = 'none'; // no placement, hide bbox
  }

  // reset zoom
  img.style.transform = 'scale(1)';
}

// Call Replicate model
async function callReplicateModel(token, modelVersion, inputObj) {
  const response = await fetch(REPLICATE_PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      version: modelVersion,
      input: inputObj,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model call failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

// Process image with Seedream-4
async function processWithSeedream(token, newImageDataURL, lastImageDataURL) {
  const input = {
    size: '2K',
    width: 2048,
    height: 2048,
    prompt:
      "insert seamlessly the second image within or inside the first image. you're free to put it anywhere and as part of any object that makes most sense with the environment of the first image.",
    max_images: 4,
    image_input: [lastImageDataURL, newImageDataURL],
    aspect_ratio: '4:3',
    sequential_image_generation: 'auto',
  };

  const result = await callReplicateModel(token, SEEDREAM_MODEL, input);

  // Extract the first generated image URL from the result
  if (
    result.output &&
    Array.isArray(result.output) &&
    result.output.length > 0
  ) {
    return result.output[0];
  }

  throw new Error('No output generated from Seedream-4 model');
}

// STEP 2: Save image data to Firebase Realtime Database
async function saveImageToDatabase(imageData) {
  const imagesRef = ref(database, 'images');
  const newImageRef = push(imagesRef);
  await set(newImageRef, imageData);
  return newImageRef.key;
}

// Main upload handler
async function handleImageUpload(currImg, objectToSearch) {
  console.log('🎊 uploading image for ', currImg, objectToSearch);
  if (!currImg) {
    return;
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showStatus('Please save your Replicate API token first', 'error');
    return;
  }

  if (!database) {
    showStatus('Firebase not initialized', 'error');
    return;
  }

  let finalDataURL;
  let isGenerated;
  let originalDataURL;
  let placement;
  let objectToSearchURL;

  try {
    // show which image is being processed (use filename if available)
    const displayName = currImg.title || currImg.url;
    showLoading(`Processing: ${displayName}`);
    showStatus('Processing image...', 'success');

    const timestamp = new Date().toISOString();

    // Convert file to base64 data URL
    console.log('Converting image to base64...', currImg, objectToSearch);
    originalDataURL = await imageUrlToBase64(currImg.url);
    if (objectToSearch)
      objectToSearchURL = await imageUrlToBase64(objectToSearch.url);

    console.log('Base64 conversion complete');

    finalDataURL = originalDataURL;
    isGenerated = false;

    // If this is not the first image and , process with Seedream-4
    if (currentImages.length > 0 && objectToSearchURL) {
      const lastImage = currentImages[currentImages.length - 1];
      console.log('Processing with Seedream-4...');

      try {
        showStatus('Processing with Seedream-4 model...', 'success');

        // For Seedream, we might need to use the original data URL directly
        // or convert it to a temporary URL that Replicate can access
        const generatedUrl = await processWithSeedream(
          token,
          originalDataURL,
          lastImage.dataURL,
        );

        // Convert the generated URL back to base64 for storage
        console.log('Converting generated image to base64...');
        finalDataURL = await urlToDataURL(generatedUrl);
        isGenerated = true;

        console.log('🌙 [SEEDREAM] Generated image converted to base64!');

        // STEP 3: analyze image difference to find the new object estimated location / bbox
        placement = await analyzeImagePlacement(
          token,
          finalDataURL,
          objectToSearchURL,
        );
        console.log('🎆 Image placement analysis:', placement);

        // break workflow if no final data URL of converted image found and the db already have images
        if (!finalDataURL && currentImages.length !== 0) return;
      } catch (error) {
        console.error('Seedream processing error:', error);
        showStatus(
          'Model processing failed, using original image: ' + error.message,
          'error',
        );
      }
    }

    // STEP 5: Save to database
    const imageData = {
      idx: currentImages.length === 0 ? 0 : currentImages.length,
      title: currImg.title,
      dataURL: finalDataURL,
      originalDataURL: originalDataURL,
      wikiDataUrl: objectToSearchURL || null,
      placement: placement || null,
      timestamp: timestamp,
      isGenerated: isGenerated,
      width: 2048,
      height: 2048,
    };

    console.log('Saving to database...');
    showStatus('Saving to database...', 'success');

    await saveImageToDatabase(imageData);

    // Add to current images and cache
    const newImage = {
      id: Date.now().toString(),
      ...imageData,
    };
    currentImages.push(newImage);
    imageCache.set(finalDataURL, finalDataURL);

    // Re-render timeline
    renderTimeline();

    hideLoading();
  } catch (error) {
    console.error('Upload error:', error);
    hideLoading();
    showStatus('Upload failed: ' + error.message, 'error');
  }
}

// STEP 3: analyze image difference to find the new object estimated location / bbox
// Function to analyze image placement using GPT-4V
async function analyzeImagePlacement(token, afterImageDataURL, objectToSearch) {
  console.log('🔍 Starting image placement analysis...');

  const prompt = `
      I have 3 images:
    1. AFTER or the second image in the image_input array: The result after inserting the new image into the original composite image.
    2. The object to be searched that was submitted from wikipedia result prior to the current image generation.

    Please analyze where the object to be searched (which is the second image in the image_input array) is at within the AFTER image (which is the first image in the image_input array). Return ONLY a JSON object with the bounding box coordinates as percentages (0-100) of the image dimensions:

    {
      "placement": {
        "x": number (left edge as % from left),
        "y": number (top edge as % from top), 
        "width": number (width as % of total width),
        "height": number (height as % of total height),
        "centerX": number (center X as % from left),
        "centerY": number (center Y as % from top),
        "description": "brief description of where it was placed",
        "confidence": number (0-1, how confident you are)
      }
    }
  `;
  try {
    const response = await fetch(REPLICATE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        input: {
          prompt: prompt,
          image_input: [afterImageDataURL, objectToSearch],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
      });
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const output = result.output.join('\n');

    // Extract the output text
    let outputText = '';
    if (result.output && Array.isArray(result.output)) {
      outputText = result.output.join('\n');
    } else if (result.output && typeof result.output === 'string') {
      outputText = result.output;
    } else {
      console.error('❌ Unexpected result structure:', result);
      return null;
    }

    console.log('🔍 Raw output text:', outputText);

    // Clean up the spaced-out text by removing extra spaces between characters
    const cleanedText = outputText
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/"\s+"/g, '""') // Fix spaced quotes
      .replace(/:\s+/g, ':') // Remove spaces after colons
      .replace(/,\s+/g, ',') // Remove spaces after commas
      .replace(/{\s+/g, '{') // Remove spaces after opening braces
      .replace(/\s+}/g, '}') // Remove spaces before closing braces
      .replace(/\[\s+/g, '[') // Remove spaces after opening brackets
      .replace(/\s+\]/g, ']') // Remove spaces before closing brackets
      .trim();

    console.log('🧹 Cleaned text:', cleanedText);

    // Try to extract JSON from the cleaned text
    let jsonText = cleanedText;

    // Look for JSON object in the text
    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    console.log('📝 Extracted JSON text:', jsonText);

    // Parse the JSON
    let placementData;
    try {
      placementData = JSON.parse(jsonText);
      console.log('✅ Successfully parsed placement data:', placementData);
    } catch (parseError) {
      console.error('❌ Error parsing JSON:', parseError);
      console.error('Text that failed to parse:', jsonText);

      // Try alternative parsing approach - remove all spaces between characters
      try {
        const alternativeText = outputText.replace(/\s/g, '');
        console.log('🔄 Trying alternative parsing:', alternativeText);
        placementData = JSON.parse(alternativeText);
        console.log('✅ Alternative parsing successful:', placementData);
      } catch (altError) {
        console.error('❌ Alternative parsing also failed:', altError);
        return null;
      }
    }

    // Validate the structure
    if (!placementData || !placementData.placement) {
      console.error('❌ Invalid placement data structure:', placementData);
      return null;
    }

    console.log('🎯 Final placement result:', placementData.placement);

    // update
    return placementData.placement;
  } catch (error) {
    console.error('Error analyzing placement with model:', error);
    return null;
  }
}

// Zoom + scroll image navigation
let virtualScroll = 0;

window.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault(); // prevent default scrolling

    if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) return;
    if (!currentImages[currentImgIdx].placement) return;

    // accumulate delta
    virtualScroll += e.deltaY;

    // --- zoom (always applied) ---
    img.style.transform = `scale(${1 + Math.max(0, virtualScroll) * 0.001})`;
    img.style.transformOrigin =
      currentImages[currentImgIdx].placement.centerX +
      '% ' +
      currentImages[currentImgIdx].placement.centerY +
      '%';

    // --- navigation (only when threshold reached) ---
    if (virtualScroll < -100) {
      // scroll down → next image
      if (currentImgIdx < currentImages.length - 1) {
        currentImgIdx++;
        img.src = currentImages[currentImgIdx].dataURL;
      }
      virtualScroll = 0; // reset after changing image
      img.style.transform = 'scale(1)';
    } else if (virtualScroll > 400) {
      // scroll up → previous image
      if (currentImgIdx > 0) {
        currentImgIdx--;
        img.src = currentImages[currentImgIdx].dataURL;
      }
      virtualScroll = 0; // reset after changing image
      img.style.transform = 'scale(1)';
    }
  },
  { passive: false },
);

// Timeline cursor effect
document.addEventListener('mousemove', (e) => {
  const body = document.body;
  const x = e.clientX / window.innerWidth;
  const y = e.clientY / window.innerHeight;
  body.style.setProperty('--cursor-x', x);
  body.style.setProperty('--cursor-y', y);

  // Update cursor element position and make it visible
  cursorEl.style.left = `${e.clientX}px`; // Use actual pixel position instead of percentage
  cursorEl.style.top = '0';
  cursorEl.style.opacity = '0.5'; // Make it visible (was set to '0')

  // Optional: Add fade out effect
  clearTimeout(cursorEl.fadeTimeout);
  cursorEl.fadeTimeout = setTimeout(() => {
    cursorEl.style.opacity = '0.2';
  }, 500);
});

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing...');

  // Auto-initialize Firebase
  initializeFirebase();

  // Button handlers for token management only
  const saveTokenBtn = $('saveToken');
  if (saveTokenBtn) {
    saveTokenBtn.addEventListener('click', () => {
      const tokenInput = $('replicateToken');
      if (!tokenInput) return;

      const token = tokenInput.value.trim();
      if (!token) {
        showStatus('Please enter a token', 'error');
        return;
      }

      localStorage.setItem(TOKEN_KEY, token);
      renderTokenStatus();
      showStatus('Token saved successfully!');
    });
  }

  const clearTokenBtn = $('clearToken');
  if (clearTokenBtn) {
    clearTokenBtn.addEventListener('click', () => {
      localStorage.removeItem(TOKEN_KEY);
      const tokenInput = $('replicateToken');
      if (tokenInput) tokenInput.value = '';
      renderTokenStatus();
      showStatus('Token cleared');
    });
  }

  // Initial render
  renderTokenStatus();
});

// WIKIPEDIA
// WIKIPEDIA BACKLINKS
async function fetchWikimediaImagesWithBacklinks(
  keyword,
  maxDepth = 3, // limit the number of recursion
  visited = new Set(),
) {
  if (!keyword) return;
  // visited.add(keyword); // todo: check visited to avoid cycles

  // Step 1: Get the first image from the main page
  console.log('Fetching image for pageeeee:', keyword);
  await fetchFirstImageFromPage(keyword);

  // Step 2: Get backlinks for this page
  const backlinksUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&list=backlinks&bltitle=${encodeURIComponent(
    keyword,
  )}&bllimit=1&format=json`;

  try {
    const resp = await fetch(backlinksUrl);
    const data = await resp.json();
    const backlink = data.query?.backlinks[0] || null; // take the first backlink

    if (wikiImages.length > maxDepth) return;
    const title = backlink?.title || null;
    if (title) {
      // recursively fetch images from backlinks
      await fetchWikimediaImagesWithBacklinks(title);
    }
  } catch (err) {
    console.error('Error fetching backlinks for', keyword, err);
  }
}

// Helper: fetch the first valid image from a Wikipedia page
async function fetchFirstImageFromPage(pageTitle) {
  console.log('Fetching first image for page:', pageTitle);

  const imagesUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&titles=${encodeURIComponent(
    pageTitle,
  )}&prop=images&format=json`;

  try {
    const imagesResp = await fetch(imagesUrl);
    const imagesData = await imagesResp.json();
    const pages = Object.values(imagesData.query.pages);
    if (!pages.length || !pages[0].images) return;

    // Loop through all images until we find a usable one
    for (const img of pages[0].images) {
      const infoUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&titles=${encodeURIComponent(
        img.title,
      )}&prop=imageinfo&iiprop=url&format=json`;

      try {
        const resp = await fetch(infoUrl);
        const data = await resp.json();
        const imgPages = Object.values(data.query.pages);
        const imageUrl = imgPages[0]?.imageinfo?.[0]?.url;

        if (imageUrl && imageUrl.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
          wikiImages.push({
            title: pageTitle,
            url: imageUrl,
          });
          console.log('Found image:', imageUrl);
          break; // Stop after first usable image
        }
      } catch (err) {
        console.warn('Failed to get image info for', img.title, err);
      }
    }
  } catch (err) {
    console.warn('Failed to get images from page', pageTitle, err);
  }
}

// Example usage with a search input
const searchInput = document.getElementById('searchKeyword');
const searchBtn = document.getElementById('searchBtn');
const resultImg = document.getElementById('resultImage');

searchBtn.addEventListener('click', async () => {
  let keyword = searchInput.value.trim();
  if (!keyword) return;

  // clear old data first
  await set(ref(database, 'images'), null);
  wikiImages = [];
  currentImages = [];

  // GET ALL RECURSED BACKLINKS
  await fetchWikimediaImagesWithBacklinks(keyword); // this fn saves the result to wikiImages global var

  if (wikiImages.length > 0) {
    // PROCESS IMAGES from the BACKLINKS
    for (let i = 0; i < wikiImages.length; i++) {
      const prevImg = i === 0 ? null : wikiImages[i - 1];
      const currImg = wikiImages[i];

      await handleImageUpload(currImg, prevImg);
    }
  }
});

// UTILS
async function imageUrlToBase64(url) {
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // returns base64 string
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
