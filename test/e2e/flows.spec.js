// End-to-end flows for Foster Card Generator.
//
// Sequential flows run against a single harness instance:
//   1. Main screen loads (task 7).
//   2. Import from Wagtopia via Scrape-from-URL (task 8).
//   3. Import from Adoptapet via Scrape-from-URL (task 8).
//   4..6 — added in later tasks.

const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('path');
const fs = require('fs');

const { setup, readAnimalsDb } = require('./harness.js');

// Shared selectors / constants.
const WAGTOPIA_URL = 'https://www.wagtopia.com/search/pet?id=2621876';
const ADOPTAPET_URL = 'https://www.adoptapet.com/pet/47438600';
const REPLACEMENT_IMAGE = path.resolve(
  __dirname,
  'fixtures',
  'images',
  'replacement.jpg'
);

// Expected values after flow 4's edit pass. Populated in flow 4, consumed in
// flows 5 and 6.
const expectedAfterEdit = {};

// Locate the grid "Create Animal" button (not the submit button inside the
// manual-entry modal, which also carries the same text). The grid button is
// rendered outside of any modal-overlay, so we filter on that.
async function clickGridCreateAnimal(window) {
  await window.locator(
    'button:has-text("Create Animal"):not(.btn-primary):not(.btn-secondary)'
  ).first().click();
}

async function waitForToast(window, text, timeout = 15000) {
  await window.waitForFunction(
    (t) => {
      const nodes = document.querySelectorAll('.toast, .toast-message, [class*="toast"]');
      for (const n of nodes) {
        if ((n.textContent || '').includes(t)) return true;
      }
      return false;
    },
    text,
    { timeout }
  );
}

test('e2e flows', async (t) => {
  const verbose = !!process.env.E2E_VERBOSE;
  const harness = await setup({ verbose });
  const { window } = harness;

  if (verbose) {
    window.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.error(`[renderer:${msg.type()}]`, msg.text());
    });
    window.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.error('[renderer:pageerror]', err.message);
    });
  }

  try {
    await t.test('flow 1 — main screen loads and is empty', async () => {
      // The renderer is a Preact SPA. On first load, `#content` shows either
      // a "Loading animals..." spinner until the DB has been opened, and then
      // either <div class="animals-grid"> (when there are animals) or a
      // <div class="loading">No animals found. Create one to get started.</div>
      // when the DB is empty. With an isolated HOME tmpdir the DB starts empty,
      // so we wait for the loading spinner to be replaced by the empty-state
      // message (or by the grid, if future changes ever render it empty) and
      // then assert there are zero animal cards.

      // First, wait for the app's main content region to exist.
      await window.waitForSelector('#content', { timeout: 30000 });

      // Then wait until the "Loading animals..." state has cleared. The empty
      // state text "No animals found" (inside #content > .loading) confirms
      // the DB query completed and returned zero rows. We also accept
      // .animals-grid in case rendering logic changes to show an empty grid.
      await window.waitForFunction(
        () => {
          const content = document.querySelector('#content');
          if (!content) return false;
          if (content.querySelector('.animals-grid')) return true;
          const loading = content.querySelector('.loading');
          if (loading && /No animals found/i.test(loading.textContent || '')) {
            return true;
          }
          return false;
        },
        null,
        { timeout: 30000 }
      );

      // Assert empty: no .animal-card elements anywhere on the page.
      const cardCount = await window.locator('.animal-card').count();
      assert.equal(cardCount, 0, `expected 0 animal cards, got ${cardCount}`);
    });

    await t.test('flow 2 — scrape Luna from Wagtopia fixture', async () => {
      // `selectedRescue` defaults to 'wagtopia' on first mount, so we can go
      // straight into the Scrape-from-URL flow.
      await clickGridCreateAnimal(window);
      await window.waitForSelector('.modal-overlay', { timeout: 5000 });
      await window.locator('button.option-button:has-text("Scrape from URL")').click();

      // Fill the URL input and click Scrape Data.
      await window.waitForSelector('#scrapeUrl', { timeout: 5000 });
      await window.locator('#scrapeUrl').fill(WAGTOPIA_URL);
      await window.locator('button.btn-primary:has-text("Scrape Data")').click();

      // Wait for the ManualEntryModal to appear with pre-filled Luna data.
      await window.waitForFunction(
        () => {
          const input = document.querySelector('#name');
          return input && input.value === 'Luna';
        },
        null,
        { timeout: 30000 }
      );

      // Verify all scraper-populated fields match the fixture.
      assert.equal(await window.locator('#name').inputValue(), 'Luna');
      assert.equal(
        await window.locator('#breed').inputValue(),
        'Labrador Retriever Mix'
      );
      assert.equal(await window.locator('#ageLong').inputValue(), '3 Years');
      assert.equal(await window.locator('#ageShort').inputValue(), '3 Yr');
      assert.equal(await window.locator('#size').inputValue(), 'Medium');
      assert.equal(await window.locator('#gender').inputValue(), 'Spayed(F)');
      assert.equal(await window.locator('#shots').inputValue(), '1');
      assert.equal(await window.locator('#housetrained').inputValue(), '1');
      assert.equal(await window.locator('#kids').inputValue(), '1');
      assert.equal(await window.locator('#dogs').inputValue(), '1');
      assert.equal(await window.locator('#cats').inputValue(), '1');

      const bio = await window.locator('#bio').inputValue();
      assert.ok(/Luna is a sweet/i.test(bio), `bio looks wrong: ${bio}`);

      // Click Create Animal in the modal footer (btn-primary inside footer).
      await window
        .locator('.modal-footer button.btn-primary:has-text("Create Animal")')
        .click();

      // Wait for modal to close and a card to appear.
      await window.waitForFunction(
        () => !document.querySelector('.modal-overlay'),
        null,
        { timeout: 10000 }
      );
      await window.waitForSelector('.animal-card', { timeout: 10000 });
      const count = await window.locator('.animal-card').count();
      assert.equal(count, 1, `expected 1 animal card after flow 2, got ${count}`);
    });

    await t.test('flow 3 — scrape Rocco from Adoptapet fixture', async () => {
      // The scrape-from-URL handler dispatches by the current `selectedRescue`
      // state, which defaults to 'wagtopia' and only flips when the user goes
      // through Select-from-Site → Brass City. Navigate that path first and
      // cancel out of the SelectFromSite modal to flip state, then continue
      // with the standard Scrape-from-URL flow.
      await clickGridCreateAnimal(window);
      await window.waitForSelector('.modal-overlay', { timeout: 5000 });
      await window
        .locator('button.option-button:has-text("Select from Site")')
        .click();
      // RescueSelectModal — click Brass City.
      await window
        .locator('button.option-button:has-text("Brass City")')
        .click();
      // SelectFromSiteModal opens and begins loading the adoptapet animal list.
      // We don't have a list fixture, so the list request will 404 at the
      // proxy and the modal will render "No animals found". Close it via
      // the × in the header so we're back on the grid.
      await window.waitForSelector(
        '.modal-overlay .modal-header button.modal-close',
        { timeout: 10000 }
      );
      // The SelectFromSite modal is the only overlay currently open; its ×
      // is the first matching one.
      await window.locator('.modal-overlay .modal-header button.modal-close').first().click();
      await window.waitForFunction(
        () => !document.querySelector('.modal-overlay'),
        null,
        { timeout: 10000 }
      );

      // Now do the actual Scrape-from-URL flow; selectedRescue is 'adoptapet'.
      await clickGridCreateAnimal(window);
      await window.waitForSelector('.modal-overlay', { timeout: 5000 });
      await window.locator('button.option-button:has-text("Scrape from URL")').click();
      await window.waitForSelector('#scrapeUrl', { timeout: 5000 });
      await window.locator('#scrapeUrl').fill(ADOPTAPET_URL);
      await window.locator('button.btn-primary:has-text("Scrape Data")').click();

      // Wait for the ManualEntryModal with Rocco's data.
      await window.waitForFunction(
        () => {
          const input = document.querySelector('#name');
          return input && input.value === 'Rocco';
        },
        null,
        { timeout: 30000 }
      );

      assert.equal(await window.locator('#name').inputValue(), 'Rocco');
      assert.equal(
        await window.locator('#breed').inputValue(),
        'Pit Bull Terrier Mix'
      );
      assert.equal(await window.locator('#ageLong').inputValue(), '2 Years');
      assert.equal(await window.locator('#ageShort').inputValue(), '2 Yr');
      assert.equal(await window.locator('#size').inputValue(), 'Medium');
      assert.equal(await window.locator('#gender').inputValue(), 'Neutered(M)');
      assert.equal(await window.locator('#shots').inputValue(), '1');
      assert.equal(await window.locator('#housetrained').inputValue(), '1');
      assert.equal(await window.locator('#kids').inputValue(), '1');
      assert.equal(await window.locator('#dogs').inputValue(), '1');
      assert.equal(await window.locator('#cats').inputValue(), '0');

      const bio = await window.locator('#bio').inputValue();
      assert.ok(/Rocco is a sweet/i.test(bio), `bio looks wrong: ${bio}`);

      // Click Create Animal in the modal footer.
      await window
        .locator('.modal-footer button.btn-primary:has-text("Create Animal")')
        .click();

      await window.waitForFunction(
        () => !document.querySelector('.modal-overlay'),
        null,
        { timeout: 10000 }
      );
      // Expect two cards in the grid now.
      await window.waitForFunction(
        () => document.querySelectorAll('.animal-card').length === 2,
        null,
        { timeout: 10000 }
      );
      const count = await window.locator('.animal-card').count();
      assert.equal(count, 2, `expected 2 animal cards after flow 3, got ${count}`);
    });

    await t.test('flow 4 — edit all 31 fields on Luna (incl. image swap)', async () => {
      // Open the Luna card (first card, data-id="1").
      await window.locator('div.animal-card[data-id="1"]').click();
      await window.waitForSelector('.modal-overlay', { timeout: 5000 });

      // Wait for the EditAnimalModal's form to be populated with Luna's data
      // so we know the modal finished mounting.
      await window.waitForFunction(
        () => {
          const input = document.querySelector('#name');
          return input && input.value === 'Luna';
        },
        null,
        { timeout: 10000 }
      );

      // ------------------------------------------------------------------
      // 1. Swap the image via the hidden ImageUpload file input.
      // ------------------------------------------------------------------
      // The ImageUpload widget renders a hidden <input type="file">. The edit
      // modal is the only modal open with that input, so .first() is safe.
      await window
        .locator('input[type="file"]')
        .first()
        .setInputFiles(REPLACEMENT_IMAGE);

      // Wait for the preview to reflect the new image (the <img class="modal-image">
      // src switches from the scraped URL to a data: URL once imageData is set).
      await window.waitForFunction(
        () => {
          const img = document.querySelector('.modal-image');
          return !!img && typeof img.src === 'string' && img.src.startsWith('data:');
        },
        null,
        { timeout: 10000 }
      );

      // ------------------------------------------------------------------
      // 2. Fill the 13 text/select fields on the main form.
      // ------------------------------------------------------------------
      await window.locator('#name').fill('Luna EDITED');
      await window.locator('#breed').fill('Labrador EDITED');
      await window.locator('#slug').fill('https://example.test/luna-edited');
      await window.locator('#ageLong').fill('5 Years');
      await window.locator('#ageShort').fill('5 Yr');
      await window.locator('#size').selectOption('Large');
      await window.locator('#gender').selectOption('Neutered(M)');
      await window.locator('#shots').selectOption('0');
      await window.locator('#housetrained').selectOption('0');

      // #rescue: select the second <option>. Capture the chosen value so we
      // can assert it later.
      await window.locator('#rescue').selectOption({ index: 1 });
      const rescueIdStr = await window.locator('#rescue').inputValue();
      const rescueIdInt = parseInt(rescueIdStr, 10);

      await window.locator('#kids').selectOption('0');
      await window.locator('#dogs').selectOption('?');
      await window.locator('#cats').selectOption('1');

      // ------------------------------------------------------------------
      // 3. Fill the bio textarea.
      // ------------------------------------------------------------------
      const editedBio =
        'Line 1: Luna has been fully edited.\nLine 2: The quick brown fox.';
      await window.locator('#bio-edit').fill(editedBio);

      // ------------------------------------------------------------------
      // 4. Flyer attributes — open the sub-modal, fill 16 inputs, save it.
      // ------------------------------------------------------------------
      await window
        .locator('button.btn-secondary:has-text("Edit Flyer Attributes")')
        .click();

      // Wait for the sub-modal to mount — it has 16 Attribute N inputs. When
      // it is fully loaded (not showing the "Loading..." placeholder), the
      // inputs are present.
      await window.waitForFunction(
        () => {
          const inputs = document.querySelectorAll(
            'input[placeholder^="Attribute "]'
          );
          return inputs.length === 16;
        },
        null,
        { timeout: 10000 }
      );

      const expectedAttributes = [];
      for (let i = 1; i <= 16; i++) {
        const val = `Trait ${i}`;
        expectedAttributes.push(val);
        await window
          .locator(`input[placeholder="Attribute ${i}"]`)
          .fill(val);
      }

      await window
        .locator('button.btn-primary:has-text("Save Attributes")')
        .click();

      // Wait for the sub-modal to close. The EditAnimalModal is still open,
      // so there should be exactly one .modal-overlay remaining.
      await window.waitForFunction(
        () => document.querySelectorAll('.modal-overlay').length === 1,
        null,
        { timeout: 10000 }
      );

      // ------------------------------------------------------------------
      // 5. Save the EditAnimalModal.
      // ------------------------------------------------------------------
      await window
        .locator('.modal-footer button.btn-primary:has-text("Save Changes")')
        .click();

      await waitForToast(window, 'Luna EDITED updated successfully');

      // Wait for the EditAnimalModal to close.
      await window.waitForFunction(
        () => !document.querySelector('.modal-overlay'),
        null,
        { timeout: 10000 }
      );

      // ------------------------------------------------------------------
      // 6. Record expected values for flows 5 and 6.
      // ------------------------------------------------------------------
      Object.assign(expectedAfterEdit, {
        name: 'Luna EDITED',
        breed: 'Labrador EDITED',
        slug: 'https://example.test/luna-edited',
        age_long: '5 Years',
        age_short: '5 Yr',
        size: 'Large',
        gender: 'Neutered(M)',
        shots: 0,
        housetrained: 0,
        rescue_id: rescueIdInt,
        kids: '0',
        dogs: '?',
        cats: '1',
        bio: editedBio,
        attributes: expectedAttributes,
        imagePath: REPLACEMENT_IMAGE,
      });

      // ------------------------------------------------------------------
      // 7. Direct sqlite assertion.
      // ------------------------------------------------------------------
      const rows = await readAnimalsDb(harness.tmpHome);
      const luna = rows.find((r) => r.id === 1);
      assert.ok(luna, 'animal id=1 should exist after edit');
      assert.equal(luna.name, 'Luna EDITED');
      assert.equal(luna.breed, 'Labrador EDITED');
      assert.equal(luna.slug, 'https://example.test/luna-edited');
      assert.equal(luna.age_long, '5 Years');
      assert.equal(luna.age_short, '5 Yr');
      assert.equal(luna.size, 'Large');
      assert.equal(luna.gender, 'Neutered(M)');
      assert.equal(luna.shots, 0);
      assert.equal(luna.housetrained, 0);
      assert.equal(luna.rescue_id, rescueIdInt);
      assert.equal(luna.kids, '0');
      assert.equal(luna.dogs, '?');
      assert.equal(luna.cats, '1');
      assert.equal(luna.bio, editedBio);
      assert.deepEqual(JSON.parse(luna.attributes), expectedAttributes);
      assert.ok(
        luna.portrait_data && luna.portrait_data.length > 0,
        'portrait_data should be non-empty after image swap'
      );
    });

    await t.test('flow 5 — reopen Luna and assert all 31 fields persisted', async () => {
      // Reopen the Luna card (still data-id="1").
      await window.locator('div.animal-card[data-id="1"]').click();
      await window.waitForSelector('.modal-overlay', { timeout: 5000 });

      // Wait for the EditAnimalModal's form to be populated with the edited
      // name so we know the modal finished mounting with fresh DB data.
      await window.waitForFunction(
        () => {
          const input = document.querySelector('#name');
          return input && input.value === 'Luna EDITED';
        },
        null,
        { timeout: 10000 }
      );

      // ------------------------------------------------------------------
      // 1. Main-form 13 text/select fields.
      // ------------------------------------------------------------------
      assert.equal(await window.locator('#name').inputValue(), expectedAfterEdit.name);
      assert.equal(await window.locator('#breed').inputValue(), expectedAfterEdit.breed);
      assert.equal(await window.locator('#slug').inputValue(), expectedAfterEdit.slug);
      assert.equal(await window.locator('#ageLong').inputValue(), expectedAfterEdit.age_long);
      assert.equal(await window.locator('#ageShort').inputValue(), expectedAfterEdit.age_short);
      assert.equal(await window.locator('#size').inputValue(), expectedAfterEdit.size);
      assert.equal(await window.locator('#gender').inputValue(), expectedAfterEdit.gender);
      assert.equal(await window.locator('#shots').inputValue(), String(expectedAfterEdit.shots));
      assert.equal(
        await window.locator('#housetrained').inputValue(),
        String(expectedAfterEdit.housetrained)
      );
      assert.equal(
        await window.locator('#rescue').inputValue(),
        String(expectedAfterEdit.rescue_id)
      );
      assert.equal(await window.locator('#kids').inputValue(), expectedAfterEdit.kids);
      assert.equal(await window.locator('#dogs').inputValue(), expectedAfterEdit.dogs);
      assert.equal(await window.locator('#cats').inputValue(), expectedAfterEdit.cats);

      // ------------------------------------------------------------------
      // 2. Bio textarea.
      // ------------------------------------------------------------------
      assert.equal(
        await window.locator('#bio-edit').inputValue(),
        expectedAfterEdit.bio
      );

      // ------------------------------------------------------------------
      // 3. Image: the <img class="modal-image"> should now render the
      //    replacement image via a data: URL sourced from the DB's
      //    portrait_data blob. Decode the data URL and compare bytes to
      //    the replacement.jpg fixture on disk.
      // ------------------------------------------------------------------
      const imgSrc = await window.locator('img.modal-image').first().getAttribute('src');
      assert.ok(
        typeof imgSrc === 'string' && imgSrc.startsWith('data:'),
        `expected data: URL for reopened image, got: ${imgSrc && imgSrc.slice(0, 40)}`
      );
      const commaIdx = imgSrc.indexOf(',');
      assert.ok(commaIdx > 0, 'data URL missing comma separator');
      const b64 = imgSrc.slice(commaIdx + 1);
      const imgBytes = Buffer.from(b64, 'base64');
      const fixtureBytes = fs.readFileSync(expectedAfterEdit.imagePath);
      assert.equal(
        imgBytes.length,
        fixtureBytes.length,
        `rendered image byte length ${imgBytes.length} != fixture ${fixtureBytes.length}`
      );
      assert.ok(
        imgBytes.equals(fixtureBytes),
        'rendered image bytes do not match replacement.jpg fixture'
      );

      // ------------------------------------------------------------------
      // 4. Flyer attributes: open the sub-modal again and read all 16.
      // ------------------------------------------------------------------
      await window
        .locator('button.btn-secondary:has-text("Edit Flyer Attributes")')
        .click();

      await window.waitForFunction(
        () => {
          const inputs = document.querySelectorAll(
            'input[placeholder^="Attribute "]'
          );
          return inputs.length === 16;
        },
        null,
        { timeout: 10000 }
      );

      for (let i = 1; i <= 16; i++) {
        const val = await window
          .locator(`input[placeholder="Attribute ${i}"]`)
          .inputValue();
        assert.equal(
          val,
          expectedAfterEdit.attributes[i - 1],
          `attribute ${i} expected "${expectedAfterEdit.attributes[i - 1]}", got "${val}"`
        );
      }

      // Close the flyer attributes sub-modal via its Cancel button so we
      // don't re-save and don't accidentally mutate state. The sub-modal is
      // rendered as a sibling *after* the EditAnimalModal in JSX, so it is
      // last in DOM order — .last() targets the sub-modal's footer.
      await window
        .locator('.modal-footer button.btn-secondary:has-text("Cancel")')
        .last()
        .click();

      await window.waitForFunction(
        () => document.querySelectorAll('.modal-overlay').length === 1,
        null,
        { timeout: 10000 }
      );

      // Close the EditAnimalModal (Cancel) so subsequent flows start clean.
      await window
        .locator('.modal-footer button.btn-secondary:has-text("Cancel")')
        .click();

      await window.waitForFunction(
        () => !document.querySelector('.modal-overlay'),
        null,
        { timeout: 10000 }
      );
    });

    await t.test('flow 6 — paranoia-level sqlite assertion', async () => {
      // Read the sqlite file one more time, directly, with no UI involvement.
      // Every scalar column + JSON-decoded attributes + portrait_data blob is
      // re-verified against the expected values recorded during flow 4.
      const rows = await readAnimalsDb(harness.tmpHome);
      const luna = rows.find((r) => r.id === 1);
      assert.ok(luna, 'animal id=1 should still exist at end of run');

      // Scalar columns.
      assert.equal(luna.name, expectedAfterEdit.name);
      assert.equal(luna.breed, expectedAfterEdit.breed);
      assert.equal(luna.slug, expectedAfterEdit.slug);
      assert.equal(luna.age_long, expectedAfterEdit.age_long);
      assert.equal(luna.age_short, expectedAfterEdit.age_short);
      assert.equal(luna.size, expectedAfterEdit.size);
      assert.equal(luna.gender, expectedAfterEdit.gender);
      assert.equal(luna.shots, expectedAfterEdit.shots);
      assert.equal(luna.housetrained, expectedAfterEdit.housetrained);
      assert.equal(luna.rescue_id, expectedAfterEdit.rescue_id);
      assert.equal(luna.kids, expectedAfterEdit.kids);
      assert.equal(luna.dogs, expectedAfterEdit.dogs);
      assert.equal(luna.cats, expectedAfterEdit.cats);
      assert.equal(luna.bio, expectedAfterEdit.bio);

      // attributes JSON.
      assert.deepEqual(
        JSON.parse(luna.attributes),
        expectedAfterEdit.attributes
      );

      // portrait_data blob: non-null and length matches the replacement image
      // on disk within a small margin. The app stores the raw bytes of the
      // uploaded file (no re-encoding), so lengths should match exactly — but
      // allow a small tolerance in case future preprocessing is added.
      assert.ok(
        luna.portrait_data && luna.portrait_data.length > 0,
        'portrait_data should be non-empty'
      );
      const fixtureBytes = fs.readFileSync(expectedAfterEdit.imagePath);
      const blobLen = luna.portrait_data.length;
      const fixtureLen = fixtureBytes.length;
      const margin = Math.max(1024, Math.ceil(fixtureLen * 0.05));
      assert.ok(
        Math.abs(blobLen - fixtureLen) <= margin,
        `portrait_data length ${blobLen} not within ${margin} bytes of fixture ${fixtureLen}`
      );
    });
  } finally {
    await harness.cleanup();
  }
});
