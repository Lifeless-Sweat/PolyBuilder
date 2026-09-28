# PolyBuilder

PolyBuilder is an automated track generator for the low-poly racing game **PolyTrack**. Powered by GitHub Actions, the tool generates custom track import codes and visual layout previews natively in the cloud via manual workflow dispatch.

---

## Features

* **GitHub Actions Integrated:** Run generation workflows completely in the cloud without local environment setups.
* **Custom Track Length:** Configure specific lengths between **10 and 150 track segments** to control map scale and complexity.
* **Environment Themes:** Supports layout generation optimized for **Summer**, **Winter**, or **Desert** biomes.
* **Seed-Based Generation:** Input specific seeds for deterministic, reproducible designs, or randomize them to discover new layouts.
* **Instant Visual Previews:** Generates an ASCII text map preview alongside the raw track code to visualize the layout before importing.

---

## How to Use It

### Generating a Track via GitHub Actions

1. Go to the **Actions** tab at the top of your GitHub repository.
2. In the left sidebar, select the **PolyTrack AI Builder** workflow.
3. Click the **Run workflow** dropdown button on the right side of the interface.
4. Configure the generation parameters:
   * **Track Parts:** Provide a number from `10` to `150`.
   * **Environment Theme:** Choose `Summer`, `Winter`, or `Desert`.
   * **Seed:** Enter an alphanumeric value for a predictable layout, or leave it variable.
5. Click the green **Run workflow** button to start the process.

### Retrieving the Output

Once the workflow run completes (typically under one minute):
1. Click on the finished workflow run from the history list.
2. Scroll to the **Workflow Summary** page or check the job execution logs.
3. Locate the following outputs:
   * **Visual Layout:** An ASCII graphic mapping out the path and turns of your track.
   * **Track Code:** The raw data string configured for PolyTrack. Copy this entire string.

---

## How to Import into PolyTrack

1. Open [PolyTrack](https://kodub.com) in your web browser.
2. Select **Track Editor** from the main menu.
3. Click **Import**.
4. Paste the copied track code into the input field.
5. Click **Load** to render and test your new track.

---

## Local Development (Optional)

To modify or test the core generation algorithms locally:

```bash
# Clone the repository
git clone https://github.com

# Navigate into the project folder
cd PolyBuilder
```

---

## License

Distributed under the MIT License. See the `LICENSE` file for details.
