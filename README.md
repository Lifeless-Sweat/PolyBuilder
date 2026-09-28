# PolyBuilder

**PolyBuilder** is an automated track generator for the low-poly racing game **PolyTrack**. Powered by GitHub Actions, it generates random, procedurally stable, or AI-optimized custom track import codes and visual layout previews directly from your GitHub repository using manual workflow dispatch.

---

## Features

* **GitHub Actions Native:** No local environment or code execution required. Run it entirely from the cloud.
* **Track length:** Choose exactly between **10 to 150 track segments** to control the map's scale and complexity.
* **Environment Support:** Generate layouts tailored specifically to **Summer**, **Winter**, or **Desert** themes.
* ** Seeds:** Use specific seeds to recreate exact layouts or perfect a specific procedural design: This is optimal
* **Instant Visual Layout:** Generates a text-based ASCII map layout preview alongside the raw track code.

---

## How to Use It

Because this project utilizes GitHub Actions workflows, you do not need to install local programming dependencies unless modifying the core generation script.

### Generating a Track via GitHub Actions

1. Navigate to the top tabs of your repository and click on **Actions** (⚙️).
2. In the left-hand sidebar under *Workflows*, select **PolyTrack AI Builder**.
3. On the right side, click the **Run workflow** dropdown button.
4. Fill out the configuration fields:
   * **Track Parts:** Input a number between `10` and `150`.
   * **Environment Theme:** Select either `Summer`, `Winter`, or `Desert` from the dropdown.
   * **Seed:** Enter an alpha-numeric string or number. Choose an optimal seed for reproducible results.
5. Click the green **Run workflow** button.

### Viewing the Output

Once the execution completes (usually takes less than a minute):
1. Click on the finished workflow run.
2. Open the job details or check the **Workflow Summary** screen.
3. You will find:
   *  **Visual Layout:** A text graphic showing the flow and turns of the generated track.
   *  **Track Code:** A raw string of data optimized for the PolyTrack engine. Copy this entirely.

---

##  How to Import into PolyTrack

Once you have your generated track string from the GitHub Action output:

1. Launch [PolyTrack](https://kodub.com) in your web browser.
2. From the main menu, navigate to the **Track Editor**.
3. Select **Import**.
4. Paste the generated track code from your workflow execution summary.
5. Click **Load** and start racing!

---

##  Local Development (Optional)

If you wish to test or tweak the track generation logic on your local machine:

### Setup
```bash
# Clone the repository
git clone https://github.com
cd PolyBuilder
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
