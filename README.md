# Western Railway Procurement Chat App

A collaborative real-time chat and management system designed for the Western Railway Stores Department. This application facilitates the tracking of PLs (Purchase Ledgers?), Purchase Orders (POs), and their statuses through channel-based communication and tagging.

## Features

### 🚀 Core Functionality
- **Real-time Chat**: Dedicated chat channels for each PL number.
- **Status Tracking**: Auto-update PL status using hashtags in chat (e.g., `#Urgent`, `#Received`).
- **Master Data Management**: Bulk upload PL and PO data via CSV.
- **Dashboard**: Visual overview of total PLs and their status distribution (Urgent, Delayed, OnTime, etc.).
- **Reports**: Export comprehensive reports for all PLs or specific chat histories to CSV.

### 🖼️ Media & Profile
- **Image Sharing**: Send compressed images directly in the chat.
- **Profile Management**: Update display name, designation, and channel avatars.
- **Secure Access**: Firebase Authentication for user login.

### 🛠️ Admin Tools
- **Data Upload**: Admins can upload master sheets to update the database.
- **Restricted Actions**: Hard delete capabilities and trash management.

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6 Modules).
- **Backend**: Firebase (Firestore, Authentication, Storage via Base64).
- **Libraries**:
  - `PapaParse`: for CSV parsing/unparsing.
  - `dotenv`: Environment variable management.
- **Development Server**: `serve` npm package.

## Setup & Installation

1. **Clone the Project**
   ```bash
   git clone <repository-url>
   cd procure-chat-app
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   - Create a `.env` file in the root directory.
   - Copy the keys from `.env.example` and fill in your Firebase credentials:
   ```env
   VITE_FIREBASE_API_KEY=your_key
   VITE_FIREBASE_AUTH_DOMAIN=your_domain
   ...
   ```

4. **Run the Application**
   ```bash
   npm run dev
   ```
   This starts the local development server at `http://localhost:5173`.

5. **Build for Production**
   ```bash
   npm run build
   ```
   
## ☁️ Deployment (Vercel)

Since `.env` is gitignored, you must add environment variables manually in Vercel:

1. Import project to Vercel.
2. Go to **Settings** > **Environment Variables**.
3. Add all variables from your `.env` file (e.g., `VITE_FIREBASE_API_KEY`).
4. Redeploy the application.

## Workflow Guide

### 1. Login
- Enter your registered email and password to access the app.
- Admin features are enabled for specific domains/emails configured in `app.js`.

### 2. Managing PLs (Purchase Ledgers)
- **Search**: Use the sidebar search bar to find PLs by number or description.
- **Filter**: Click the pill-shaped chips (e.g., `Urg`, `Dly`) to filter the list by status.
- **Create**: Add new PL channels manually using the input at the bottom of the sidebar.

### 3. Chat & Status Updates
- Select a PL to open the chat panel.
- **Status Tags**: Type or click snippets like `#Urgent` or `#TPI` to update the PL's status instantly.
- **Metadata**: Fill in PO Number, Supplier, Qty, and ETA fields to attach metadata to your messages.

### 4. Admin - Master Data Upload
- Click **Master Data** -> **Upload Master Sheet**.
- Upload a CSV file with the following 9 columns:
  1. PL No | 2. Desc | 3. PO No | 4. PO Date | 5. Qty | 6. Unit | 7. DPDT | 8. Supplier | 9. Status

## File Structure

- `index.html`: Main application interface layout.
- `styles.css`: All styling, including the modern chat UI and pill-shaped tags.
- `app.js`: Core logic for Auth, Firestore interactions, UI updates, and CSV handling.
- `utils.js`: Helper functions (e.g., tag processing).
- `firebase-config.js`: Firebase initialization configuration.

## License

Internal Tool - Western Railway.
