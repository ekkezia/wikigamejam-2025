// Constants
const TOKEN_KEY = 'replicateApiToken';
const REPLICATE_PROXY =
  'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
const SEEDREAM_MODEL = 'bytedance/seedream-4';

// Global state
let firebaseApp = null;
let database = null;
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
  if (el) el.textContent = token ? `🔗 ${maskToken(token)}` : '⛓️‍💥';
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

// Render timeline UI
async function renderTimeline() {
  const timeline = $('timeline');

  if (currentImages.length === 0) {
    console.log('No images, showing upload interface'); // Debug log
    timeline.innerHTML = '<p>No images yet</p>';
    return;
  }

  const timelineImgs = await Promise.all(
    currentImages.map(async (img, index) => {
      const currImgUrl = await getWikimediaImageInfo(img.currImgUrl);

      return `
        <div class="image-item" data-index="${index}">
          <img 
            src="${img.generatedImgUrl || currImgUrl}" 
            alt="Image ${index + 1}" 
            loading="lazy"
          >
          <div class="image-info">
            ${
              img.generatedImgUrl
                ? `<a href="https://en.wikipedia.org/?curid=${
                    img.articleId
                  }" target="_blank">
                    ${img.title} ${
                    index !== currentImages.length - 1 ? '->' : ''
                  }
                  </a>`
                : `${img.title}${img.generatedImgUrl ? ' ->' : ''}`
            }
          </div>
        </div>
      `;
    }),
  );

  // ✅ Join after awaiting
  timeline.innerHTML = timelineImgs.join('');

  // ✅ Add click and hover listeners after DOM content is created
  const imageItems = document.querySelectorAll('.image-item');

  imageItems.forEach((item) => {
    item.addEventListener('click', async () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        currentImgIdx = imgData.idx;
        await renderImageInViewer(imgData);
      }
    });

    item.addEventListener('mouseover', async () => {
      const index = item.getAttribute('data-index');
      const imgData = currentImages[index];
      if (imgData) {
        currentImgIdx = imgData.idx;
        await renderImageInViewer(imgData);
      }
    });
  });
}

// #viewer div render function
const img = $('mainImage');
const bbox = $('bbox');
async function renderImageInViewer(imgData) {
  // display img
  img.style.display = 'block';

  console.log('infoooo', imgData);

  let currImgUrl;

  if (imgData.idx === 0) {
    const info = await getWikimediaImageInfo(imgData.currImgUrl);
    const b64 = await imageUrlToBase64(info);
    console.log('info', b64);
    currImgUrl = b64;
  }

  // load image
  if (!imgData.generatedImgUrl) {
    currImgUrl = await getWikimediaImageInfo(imgData.currImgUrl);
  }
  img.src = imgData.generatedImgUrl || currImgUrl;

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
    // bbox.style.backdropFilter = 'blur(4px)';
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

// [STEP 2] Process image with Seedream-4
// Process image with Seedream-4
async function processWithSeedream(token, newImageDataURL, lastImageDataURL) {
  // console.log('starting Seedream process: last', lastImageDataURL);
  // console.log('starting Seedream process: new', newImageDataURL);

  if (!newImageDataURL || !lastImageDataURL) {
    throw new Error('Both newImageDataURL and lastImageDataURL are required');
  }

  const input = {
    size: '2K',
    width: 2048,
    height: 2048,
    prompt: `
      Create a Droste-style image where the first image in the array appears as a smaller poster within the second image in the array.
      Keep the entire composition and all objects of the second image exactly in the same place — do not rearrange or distort them.
      The second image should remain fully visible and unchanged, serving as the main background.
      Place the first image inside it as a smaller printed poster, painting, or framed image that looks naturally integrated into the scene.
      The first image should appear smaller and contained within the second image, preserving the perspective and lighting of the second image.
      Do not modify or move any subjects or elements of the second image — just overlay the first image inside it.
      Ensure the entire frame is filled with the second image, with the first image clearly visible inside it, like a poster within a poster.
      `,
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
// Main upload handler
async function handleImageUpload(currImg, prevImg = null, idx) {
  if (!currImg) return;

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showStatus('Please save your Replicate API token first', 'error');
    return;
  }

  let isGenerated;
  let placement;
  let generatedImgUrl;

  // if it is first image
  if (!prevImg && currImg) {
    const imageData = {
      idx: 0,
      title: currImg.title, // local currImg has { title, pageid, ns }
      generatedImgUrl: null, // does not exist yet
      currImgUrl: currImg.url, // the object that is just added (the object that is fed to the model to be generated) // File: ...
      prevImgUrl: null, // does not exist yet
      placement: null,
      articleUrl: `https://en.wikipedia.org/?curid=${currImg.pageid}`,
      timestamp: Date.now(),
      isGenerated: isGenerated,
      width: 2048,
      height: 2048,
    };

    console.log('---[FIRST] Saving to database...---', imageData);
    showStatus('Saving to database...', 'success');

    await saveImageToLocal(imageData);

    // Add to current images and cache
    const newImage = {
      ...imageData,
    };
    currentImages.push(newImage);
  }

  // If this is not the first image, process with Seedream-4
  try {
    // show which image is being processed (use filename if available)
    const displayName = currImg.title || currImg.url;
    showLoading(`Linking to... ${displayName}`);
    showStatus('Processing image...', 'success');

    const timestamp = new Date().toISOString();

    const lastImage = currentImages[currentImages.length - 1];
    const lastImageUrl = lastImage.generatedImgUrl || lastImage.currImgUrl; // fallback if it is the SEED image

    const resolvedCurrImgUrl = await getWikimediaImageInfo(currImg.url);
    const resolvedCurrImgBase64 = await imageUrlToBase64(resolvedCurrImgUrl);

    // let previousGeneratedImg =
    const resolvedPrevImgUrl = await getWikimediaImageInfo(prevImg.url);
    const resolvedPrevImgBase64 = await imageUrlToBase64(resolvedPrevImgUrl);

    // only resolve if the last image is the SEED image because they're not generated and still in the form of File: ... from wiki

    let resolvedLastGeneratedImgUrl, resolvedLastGeneratedImgBase64;

    // address if this current processing is for the third image or beyond
    if (idx < 2) {
      // console.log('last image url', lastImageUrl);
      // If it's the third image or beyond, use the generated image URL
      resolvedLastGeneratedImgUrl = await getWikimediaImageInfo(lastImageUrl);
      resolvedLastGeneratedImgBase64 = await imageUrlToBase64(
        resolvedLastGeneratedImgUrl,
      );
    } else {
      resolvedLastGeneratedImgUrl = lastImage.generatedImgUrl;
      resolvedLastGeneratedImgBase64 = await imageUrlToBase64(
        resolvedLastGeneratedImgUrl,
      );
      // console.log('go here!', resolvedLastGeneratedImgUrl);
    }

    isGenerated = false;

    //////////////////////////////////////////////////////////////
    // If this is not the first image (prevImg EXISTS) , process with Seedream-4
    if (prevImg) {
      try {
        showStatus('Processing with Seedream-4 model...');
        console.log('processing with last image', resolvedLastGeneratedImgUrl);
        // For Seedream, we might need to use the original data URL directly
        // or convert it to a temporary URL that Replicate can access
        const res = await processWithSeedream(
          token,
          resolvedCurrImgBase64,
          resolvedLastGeneratedImgBase64,
        );

        // Convert the generated URL back to base64 for storage
        console.log('---Converting generated image to base64...---');
        console.log('ressss', res);
        generatedImgUrl = res;

        isGenerated = true;

        console.log('---🌙 [SEEDREAM] Generated image converted to base64!---');

        // STEP 3: analyze image difference to find within the curr object (prevImgBase64) in the new object (the generated image is the new object) estimated location / bbox
        let generatedImgBase64 = await imageUrlToBase64(generatedImgUrl);
        placement = await analyzeImagePlacement(
          token,
          resolvedLastGeneratedImgBase64,
          generatedImgBase64,
        );
        console.log('🎆 Image placement analysis:', placement);
      } catch (error) {
        console.error('Seedream processing error:', error);
        showStatus(
          'Model processing failed, using original image: ' + error.message,
          'error',
        );
      }
    }

    // can skip here if its first image
    // STEP 5: Save to database
    const imageData = {
      idx: currentImages.length === 0 ? 0 : currentImages.length,
      title: currImg.title, // local currImg has { title, pageid, ns }
      generatedImgUrl: generatedImgUrl, // the generated result that is rendered
      currImgUrl: currImg.url, // the object that is just added (the object that is fed to the model to be generated) // File: ...
      prevImgUrl: prevImg.url || null,
      placement: placement || null,
      articleUrl: `https://en.wikipedia.org/?curid=${currImg.pageid}`,
      timestamp: timestamp,
      isGenerated: isGenerated,
      width: 2048,
      height: 2048,
    };

    console.log('---[NOT FIRST] Saving to database...---', imageData);
    showStatus('Saving to database...', 'success');

    await saveImageToLocal(imageData);

    // Add to current images and cache
    const newImage = {
      ...imageData,
    };
    currentImages.push(newImage);

    console.log('latest curr image', currentImages);

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
// object to search should be the prevImgBase64
// Function to analyze image placement using GPT-4V
async function analyzeImagePlacement(
  token,
  beforeImageMainCharDataURL, // the main character of the previous image, for example i just added a cat before the current image (even tho the previous image is a combination of cat and Monalisa)
  afterImageDataURL,
) {
  console.log('---🔍 Starting image placement analysis...---');

  const prompt = `
      I have 2 images:
    1. The BEFORE object or the first image in the image_input array to be searched that was submitted from wikipedia result prior to the current image generation. 
    2. AFTER or the second image in the image_input array: The result after inserting the new image into the original composite image.

    Please analyze where the object or image to be searched (which is the first image in the image_input array) is located at within the AFTER image (which is the second image in the image_input array). Return ONLY a JSON object with the bounding box coordinates as percentages (0-100) of the image dimensions:

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
          image_input: [beforeImageMainCharDataURL, afterImageDataURL],
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
let isSwitching = false; // flag to prevent immediate zoom after image switch
const switchCooldown = 300; // milliseconds

window.addEventListener(
  'wheel',
  async (e) => {
    e.preventDefault(); // prevent default scrolling

    if (isSwitching) return; // ignore scroll during cooldown
    if (currentImgIdx < 0 || currentImgIdx >= currentImages.length) return;
    if (!currentImages[currentImgIdx].placement) return;

    // accumulate delta
    virtualScroll += e.deltaY;

    const viewer = $('viewer');

    const currImgUrl =
      currentImgIdx === 0
        ? img.currImgUrl
        : await getWikimediaImageInfo(img.currImgUrl);

    // --- zoom (always applied) ---
    img.style.transform = `scale(${1 + Math.max(0, virtualScroll) * 0.001})`;

    if (currentImages[currentImgIdx].placement) {
      img.style.transformOrigin =
        currentImages[currentImgIdx].placement.centerX +
        '% ' +
        currentImages[currentImgIdx].placement.centerY +
        '%';
    }

    // --- navigation (only when threshold reached) ---
    if (virtualScroll < -2000) {
      // scroll down → next image
      if (currentImgIdx < currentImages.length - 1) {
        currentImgIdx++;
        img.src = currentImages[currentImgIdx].generatedImgUrl || currImgUrl;
      }
      virtualScroll = 0;
      img.style.transform = 'scale(1)';

      // cooldown to prevent immediate zoom
      isSwitching = true;
      setTimeout(() => {
        isSwitching = false;
      }, switchCooldown);
    } else if (virtualScroll > 2000) {
      viewer.style.cursor = 'zoom-out';

      // scroll up → previous image
      if (currentImgIdx > 0) {
        viewer.style.cursor = 'zoom-out';
        currentImgIdx--;
        img.src = currentImages[currentImgIdx].generatedImgUrl || currImgUrl;
      }
      virtualScroll = 0;
      img.style.transform = 'scale(1)';

      // cooldown to prevent immediate zoom
      isSwitching = true;
      setTimeout(() => {
        isSwitching = false;
      }, switchCooldown);
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

  // hide loading
  hideLoading();

  // Auto-initialize Firebase
  // initializeFirebase();
  initializeLocalStorage();

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
let selectedBacklinks = [];
// [HELPER FOR STEP 1] to get backlink
async function getBacklink(keyword) {
  const backlinksUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=linkshere&titles=${encodeURIComponent(
    keyword,
  )}&lhlimit=1&format=json&origin=*`;

  let backlink;
  // {
  // ns:
  // title:
  // pageid:
  // }
  try {
    const resp = await fetch(backlinksUrl);
    const data = await resp.json();

    let selectedIndex = 0;

    // TODO
    // check thru selected backlinks if any of the backlink result is duplicating with the current backlink[0]
    // const backlinkId = Object.values(data.query?.pages)[0].pageid;
    // // If found duplicate,check the next backlink
    // if (selectedBacklinks.indexOf((b) => b.id === backlinkId) !== -1) {
    //   selectedIndex++;
    // }

    const randomIdx = Math.floor(
      Math.random() * Object.values(data.query?.pages).length,
    );

    backlink = Object.values(data.query?.pages)[randomIdx].linkshere[0] || null; // take the first [links here]

    if (!backlink || backlink.length === 0) return;

    return backlink;
  } catch (err) {
    console.error('Error fetching backlinks for', keyword, err);
  }
}

// [STEP 1] Gather Wikipedia Images first via backlinks
async function fetchWikimediaImagesWithBacklinks(
  keyword,
  maxDepth = 3, // limit the number of recursion
) {
  if (wikiImages.length > maxDepth) return;

  if (!keyword) return;

  // Step 1: Get all recursive backlinks for this keyword
  for (let i = 0; i < maxDepth; i++) {
    let backlinkData;
    if (selectedBacklinks.length === 0) backlinkData = keyword;
    else backlinkData = selectedBacklinks[selectedBacklinks.length - 1];
    const backlink = await getBacklink(backlinkData.title || keyword);
    selectedBacklinks.push(backlink);
  }

  // Step 2: insert the first keyword page itself too
  const firstPage = await getWikipediaArticleInfo(keyword);
  if (firstPage) selectedBacklinks.unshift(firstPage);

  console.log('selectedBacklinks:', selectedBacklinks);
  // Step 3: Get the images associated with them from Wikimedia Commons
  for (const backlink of selectedBacklinks) {
    await fetchFirstImageFromPage(backlink);
  }
}

// Helper for [STEP 1]: fetch the first valid image from a Wikipedia page
async function fetchFirstImageFromPage(backlink) {
  console.log('Fetching first image for page:', backlink);

  const imagesUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&pageids=${encodeURIComponent(
    backlink.pageid,
  )}&prop=images&format=json`;

  try {
    const imagesResp = await fetch(imagesUrl);
    const imagesData = await imagesResp.json();
    const page = Object.values(imagesData.query.pages)[0];
    //File:2017 Wahlkampf-Tour- Oberösterreich (37342740665).jpg"

    const allImages = page.images || [];

    // ✅ Only keep valid image file extensions
    const validExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.tiff',
      '.bmp',
      '.webp',
    ];
    const filteredImages = allImages.filter((img) => {
      const title = img.title.toLowerCase();
      return validExtensions.some((ext) => title.endsWith(ext));
    });

    if (filteredImages.length === 0) {
      console.warn(`No valid image files found for page: ${backlink.title}`);
      return;
    }

    // ✅ Pick a random image from filtered list
    const randomImg =
      filteredImages[Math.floor(Math.random() * filteredImages.length)];

    wikiImages.push({
      pageid: backlink.pageid,
      title: backlink.title,
      url: randomImg.title, // e.g., "File:Example.jpg"
    });
  } catch (err) {
    console.warn('Failed to get images from page', backlink, err);
  }
}

// Example usage with a search input
const searchInput = document.getElementById('searchKeyword');
const searchBtn = document.getElementById('searchBtn');

searchBtn.addEventListener('click', async () => {
  let keyword = searchInput.value.trim();
  if (!keyword) return;

  // clear old data first
  clearLocalImages();
  wikiImages = [];
  currentImages = [];
  selectedBacklinks = [];

  // Return the first image (keyword)
  // await fetchFirstImageFromPage(keyword);

  // GET ALL RECURSED BACKLINKS
  await fetchWikimediaImagesWithBacklinks(keyword); // this fn saves the result to wikiImages global var

  if (wikiImages.length > 0) {
    // PROCESS IMAGES from the BACKLINKS
    for (let i = 0; i < wikiImages.length; i++) {
      const prevImg = i === 0 ? null : wikiImages[i - 1];
      const currImg = wikiImages[i];

      await handleImageUpload(currImg, prevImg, i);
    }
  }
});

// ENTER click
document.addEventListener('keydown', async (event) => {
  // if ENTER key is pressed
  if (event.key !== 'Enter') return;

  let keyword = searchInput.value.trim();
  if (!keyword) return;

  // clear old data first
  clearLocalImages();
  wikiImages = [];
  currentImages = [];
  selectedBacklinks = [];

  // Return the first image (keyword)
  // await fetchFirstImageFromPage(keyword);

  // GET ALL RECURSED BACKLINKS
  await fetchWikimediaImagesWithBacklinks(keyword); // this fn saves the result to wikiImages global var

  if (wikiImages.length > 0) {
    // PROCESS IMAGES from the BACKLINKS
    for (let i = 0; i < wikiImages.length; i++) {
      const prevImg = i === 0 ? null : wikiImages[i - 1];
      const currImg = wikiImages[i];

      await handleImageUpload(currImg, prevImg, i);
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

async function getWikipediaArticleInfo(keyword) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    keyword,
  )}&format=json&origin=*`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0]; // page ID as string
    const pageTitle = pages[pageId].title;

    if (pageId === '-1') return null; // page does not exist

    return { pageid: parseInt(pageId), title: pageTitle };
  } catch (err) {
    console.error('Error fetching Wikipedia page ID:', err);
    return null;
  }
}

// Reset image, display viewr none
const timeline = $('timeline');
timeline.addEventListener('click', (e) => {
  // If the click is on #timeline itself or anything that is NOT .image-item or img
  if (!e.target.closest('.image-item')) {
    const viewerImg = $('mainImage');
    if (viewerImg) {
      viewerImg.style.display = 'none';
    }

    const bbox = $('bbox');
    if (bbox) bbox.style.display = 'none';

    currentImgIdx = -1; // reset current image index
  }
});

async function getWikimediaImageInfo(fileTitle) {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        fileTitle,
      )}&prop=imageinfo&iiprop=url&format=json&origin=*`,
    );
    const data = await res.json();
    const imgUrl = Object.values(data.query.pages)[0].imageinfo[0].url; // File: ...

    return imgUrl;
  } catch (error) {
    console.error('Error fetching Wikimedia image info:', error);
  }
}

// Initialize "local database" using localStorage
function initializeLocalStorage() {
  showStatus('Using local storage for persistence.');
  loadTimelineFromLocal();
  const uploadBtn = $('uploadImage');
  if (uploadBtn) uploadBtn.disabled = false;
  return true;
}

// Save an image to localStorage
async function saveImageToLocal(imageData) {
  const existing = JSON.parse(localStorage.getItem('images') || '[]');
  existing.push(imageData);
  localStorage.setItem('images', JSON.stringify(existing));
  return true;
}

// Load timeline images from localStorage
async function loadTimelineFromLocal() {
  const stored = JSON.parse(localStorage.getItem('images') || '[]');
  currentImages = stored.sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );
  renderTimeline();
}

// Clear images from localStorage
function clearLocalImages() {
  localStorage.removeItem('images');
  currentImages = [];
  renderTimeline();
}
