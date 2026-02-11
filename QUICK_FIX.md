# Quick Fix Guide - Deploy Now

## What Was Wrong?

1. **CORS blocking deployed frontend** → Backend rejecting requests from Vercel
2. **Hardcoded `/api` paths** → Not working on Vercel (no proxy in production)  
3. **Slow database queries** → "Search All Fields" timing out (no FULLTEXT index)

## What I Fixed

✅ Updated CORS to allow your Vercel domains  
✅ All API calls now use correct production URLs  
✅ Optimized search queries for better performance

## Deploy Steps (Do These Now)

### 1. Push Code Changes
```bash
git add .
git commit -m "Fix: CORS, API paths, and search performance"
git push origin main
```

### 2. Add Database Index (CRITICAL!)
This fixes the 503 errors and infinite loading in "Search All Fields":

```bash
# Connect to your production database
mysql -h <your-rds-endpoint> -u <username> -p

# Then run this:
CREATE FULLTEXT INDEX ft_document_search ON Document(
    instrumentNumber, instrumentType, legalDescription, remarks, address,
    CADNumber, CADNumber2, book, volume, page, abstractText, fieldNotes
);
```

Or use the provided SQL file:
```bash
mysql -h <rds-endpoint> -u <user> -p <database> < add_fulltext_index.sql
```

### 3. Restart Backend
```bash
# SSH to your EC2 instance
ssh ec2-user@<your-ec2-ip>

# Pull changes and restart
cd ~/TitleHero/TitleHero
git pull
docker-compose down
docker-compose up -d --build
```

### 4. Redeploy Frontend
Vercel should auto-deploy when you push to main. If not, manually trigger from Vercel dashboard.

## Test After Deployment

1. ✅ Admin Panel loads users (no "Failed to fetch")
2. ✅ Chain of Title loads (no "Failed to fetch")
3. ✅ Search All Fields works in < 5 seconds (no 503 errors)

## Still Not Working?

Check:
- Backend logs: `docker logs <container> --tail=100`
- Database index exists: `SHOW INDEX FROM Document WHERE Key_name = 'ft_document_search';`
- Correct frontend URL in Vercel: `VITE_API_TARGET` environment variable

## Files Changed
- `server/index.js` - CORS configuration
- `client/src/pages/Admin.tsx` - Import API_BASE from constants
- `client/src/pages/Dashboard/ResultsComponents/ChainOfTitle.tsx` - Use API_BASE
- `server/routes/documents.js` - Optimized search query
- `add_fulltext_index.sql` - NEW file to add database index

See [DEPLOYMENT_FIXES.md](DEPLOYMENT_FIXES.md) for detailed information.
