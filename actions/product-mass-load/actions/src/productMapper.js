const axios = require("axios");
const path = require("path");

function getMimeType(fileName) {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function downloadImageAsBase64(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000
    });

    return Buffer.from(response.data).toString("base64");
  } catch (err) {
    console.error("Image download failed:", url);
    return null; // skip image instead of breaking product
  }
}

function extractFileName(url) {
  return url.split("/").pop().split("?")[0];
}

async function mapProduct(row) {
  // category_ids: "12|45" -> [12,45]
  const categoryIds = row.category_ids
    ? row.category_ids.split("|").map(id => parseInt(id))
    : [];

  const mediaEntries = [];

  // BASE IMAGE (from URL)
  if (row.base_image) {
    const baseUrl = row.base_image.trim();

    const base64 = await downloadImageAsBase64(baseUrl);

    if (base64) {
      const fileName = extractFileName(baseUrl);

      mediaEntries.push({
        media_type: "image",
        label: "Base Image",
        position: 1,
        disabled: false,
        types: ["image", "small_image", "thumbnail"],
        content: {
          base64_encoded_data: base64,
          type: getMimeType(fileName),
          name: fileName
        }
      });
    }
  }

  // GALLERY IMAGES (multiple URLs)
  if (row.gallery_images) {
    const gallery = row.gallery_images.split("|");

    for (let i = 0; i < gallery.length; i++) {
      const imgUrl = gallery[i].trim();

      const base64 = await downloadImageAsBase64(imgUrl);

      if (base64) {
        const fileName = extractFileName(imgUrl);

        mediaEntries.push({
          media_type: "image",
          label: `Gallery ${i + 1}`,
          position: i + 2,
          disabled: false,
          types: [],
          content: {
            base64_encoded_data: base64,
            type: getMimeType(fileName),
            name: fileName
          }
        });
      }
    }
  }

  return {
    product: {
      sku: row.sku,
      name: row.name,
      price: parseFloat(row.price),
      status: 1,
      visibility: 4,
      type_id: "simple",
      attribute_set_id: parseInt(row.attribute_set_id),

      custom_attributes: [
        {
          attribute_code: "category_ids",
          value: categoryIds
        }
      ],

      media_gallery_entries: mediaEntries
    }
  };
}

module.exports = { mapProduct };