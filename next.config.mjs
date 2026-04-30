/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.ebayimg.com' },
      { protocol: 'https', hostname: '**.poshmarkimg.com' },
      { protocol: 'https', hostname: '**.poshmark.com' },
      { protocol: 'https', hostname: '**.mercdn.net' },
      { protocol: 'https', hostname: '**.etsystatic.com' },
      { protocol: 'https', hostname: '**.depopimages.com' },
      { protocol: 'https', hostname: '**.whatnot.com' },
    ],
  },
};

export default nextConfig;
