#!/usr/bin/env node
// Build the Adoptapet fixture HTML.
//
// The scraper (app/scrape-url-adoptapet.js) does the following:
//   1. Runs the regex /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g
//      against the HTML, captures each JS string literal body.
//   2. For each capture, calls JSON.parse('"' + body + '"') to decode the
//      JS string (turning \" -> ", \n -> newline, etc.) and concatenates them.
//   3. Searches the concatenated text for '"__typename":"PetDetails"' and
//      brace-matches the enclosing object, then JSON.parse's it.
//
// So we need to:
//   - JSON.stringify() the PetDetails object
//   - Take the resulting JSON text and re-JSON.stringify it to produce a
//     valid JS string literal (with escaped quotes and backslashes)
//   - Drop the surrounding quotes (the regex captures only the body)
//   - Embed that inside self.__next_f.push([1, "<body>"])
//
// This way the scraper will faithfully reconstruct the PetDetails JSON.

const fs = require('fs');
const path = require('path');

const petDetails = {
    __typename: 'PetDetails',
    petName: 'Rocco',
    petBreed: 'Pit Bull Terrier Mix (Medium)',
    petStory: 'Rocco is a sweet, energetic boy looking for a forever home.',
    petAttributes: [
        { label: 'age', content: '2 years' },
        { label: 'size', content: 'Medium' },
        { label: 'sex', content: 'Male' }
    ],
    petTraits: [
        { type: 'housetrained', status: true },
        { type: 'goodwithkids', status: true },
        { type: 'goodwithdogs', status: true },
        { type: 'goodwithcats', status: false }
    ],
    petHealthTraits: [
        { type: 'shotscurrent', status: true },
        { type: 'spayedneutered', status: true }
    ],
    petPhotos: [
        { sourcePhotoId: 'rocco-test-photo' }
    ],
    petSocialShareData: {
        sharedPhotoUrl: 'https://media.adoptapet.com/rocco-shared.jpg'
    }
};

// Produce the JSON text of the PetDetails object.
const petDetailsJson = JSON.stringify(petDetails);

// Now produce a valid JS string literal *body* (i.e. the chars between the
// surrounding double quotes of a JSON/JS string). JSON.stringify() on a string
// gives us '"..."' with all the escaping we need; slicing off the leading and
// trailing quote gives us the body.
const jsStringLiteralBody = JSON.stringify(petDetailsJson).slice(1, -1);

// The body is embedded directly in HTML between double quotes. It is already
// safe for that context — JSON.stringify escapes any embedded '"' as '\\"',
// and HTML parsing doesn't re-process backslashes inside script text.
const html = `<!doctype html><html><head><title>Rocco | Adoptapet</title></head><body>
<script>self.__next_f.push([1, "${jsStringLiteralBody}"])</script>
</body></html>
`;

const outPath = path.join(__dirname, 'pet.html');
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${html.length} bytes)`);
