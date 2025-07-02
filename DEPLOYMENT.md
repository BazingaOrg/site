# Deployment Guide

## Vercel Deployment

This site is configured for deployment on Vercel with Jekyll.

### Prerequisites

1. A Vercel account
2. Ruby and Bundler installed locally for development

### Deployment Steps

1. **Connect Repository to Vercel**
   - Import your repository in the Vercel dashboard
   - Vercel will automatically detect this as a Jekyll project

2. **Configure Domain**
   - In Vercel dashboard, go to your project settings
   - Add `site.bazinga.ink` as a custom domain
   - Configure DNS records as instructed by Vercel

3. **Environment Variables** (if needed)
   - No special environment variables required for basic setup

4. **Build Configuration**
   - The `vercel.json` file contains the build configuration
   - Build command: `bundle exec jekyll build`
   - Output directory: `_site`

### Local Development

```bash
# Install dependencies
bundle install

# Start development server
./start
# or
bundle exec jekyll serve
```

### Important Notes

- The site uses Jekyll with Ruby gems defined in `Gemfile`
- RSS feeds are configured with proper content types
- Social media integrations have been removed/simplified
- Photo services have been replaced with placeholder references

### Post-Deployment Checklist

- [ ] Verify domain is working: https://site.bazinga.ink
- [ ] Test RSS feeds: `/feed.xml`, `/notes.xml`, `/photos.xml`
- [ ] Check all internal links work correctly
- [ ] Verify social links point to correct profiles
- [ ] Test responsive design on mobile devices

### Troubleshooting

If build fails:
1. Check Ruby version compatibility in `Gemfile`
2. Ensure all dependencies are properly listed
3. Check Jekyll configuration in `_config.yml`
4. Review Vercel build logs for specific errors
