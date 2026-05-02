# Fixture Evaluation

SightBridge now has a small labeled image dataset for regression testing.

## Run

Start the local server:

```bash
python3 scripts/server.py
```

Then run:

```bash
node scripts/evaluate-fixtures.js
```

If `npm` is available:

```bash
npm run eval:fixtures
```

## Local vs Cloud Comparison

Cloud evaluation is opt-in because it sends fixture images to the configured cloud vision provider.

Start the server with an API key:

```bash
ANTHROPIC_API_KEY=... npm run dev
```

Then run:

```bash
node scripts/evaluate-fixtures.js --cloud
```

The evaluator reports whether cloud vision matched local OCR, improved a miss, or regressed.

## Current Fixtures

- `financial/credit-card-visa-platinum.webp` should be high-risk financial.
- `medical/blurry-prescription-label.jpg` should be high-risk medical.
- `public-safe/banana-bread-recipe.png` should be low-risk none.
- `identity/dc-sample-drivers-license.png` should be high-risk identity.
- `address/sample-envelope.jpg` should be medium-risk address.
- `public-safe/blue-bottle-menu.jpg` should be low-risk none.
- `financial/synthetic-bank-statement.png` should be high-risk financial.
- `screens/synthetic-email-inbox.png` should be high-risk screen.

## How To Add More

1. Put the image under `fixtures/images/<category>/`.
2. Add an entry to `fixtures/images/manifest.json`.
3. Set `expectedSeverity` and `expectedCategory`.
4. Run the evaluator.

Good next fixture groups:

- `address`: envelopes, mail, packages.
- `identity`: driver licenses, badges, student IDs.
- `screens`: banking tabs, email inboxes, private messages.
- `public-safe`: menus, bookshelves, product packaging, public signs.
