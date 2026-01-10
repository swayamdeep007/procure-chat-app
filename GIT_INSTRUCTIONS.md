# Git Setup Instructions

Follow these steps to initialize a Git repository for this project and push it to a remote platform like GitHub, GitLab, or Bitbucket.

## 1. Initialize Git Repository
Open your terminal in the project root directory and run:
```bash
git init
```

## 2. Add Files to Staging
Add all files to the repository (except those excluded by `.gitignore`):
```bash
git add .
```

## 3. Commit Changes
Create your first commit:
```bash
git commit -m "Initial commit: Western Railway Procurement Chat App"
```

## 4. Connect to a Remote Repository
Create a new repository on your chosen platform (e.g., GitHub) and follow their instructions to add the remote:
```bash
git remote add origin <your-repository-url>
git branch -M main
```

## 5. Push to Remote
Push your code to the main branch:
```bash
git push -u origin main
```

> [!IMPORTANT]
> Ensure your `.env` file is NOT tracked by Git. It is already included in the `.gitignore` file, but double-check that it remains untracked to keep your Firebase credentials secure.
