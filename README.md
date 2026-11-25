# Software-Engineering
COMP2140 repo

## How to run the system

1. Install Node.js (LTS version) from nodejs.org.
2. In a terminal, from the `software-engineering` folder:
   ```
   cd server
   npm install
   node server.js
   ```
3. Open a page in the browser, for example:
   http://localhost:3000/pages/Warranty-Report/index.html
   (For other pages, replace `Warranty-Report` with that page's folder name.)

**NB:** the pages share data through the browser's `localStorage`, which is separate for each address. Open every page through `http://localhost:3000`, not Live Server and not by double-clicking the file, so all pages see the same assets.