# frozen_string_literal: true

require 'json'

module PhotoAlbums
  module_function

  def album_slug(name)
    slug = name.to_s.strip
               .gsub(/[[:space:]]+/, '-')
               .gsub(%r{[/?#\[\]@!$&'()*+,;=]+}, '-')
               .gsub(/-+/, '-')
               .gsub(/\A-|-\z/, '')
    slug.empty? ? 'album' : slug
  end

  def album_name(photo)
    meta = photo['meta'] || {}
    source = photo['source'] || {}
    meta['album'] || source['album'] || 'album'
  end

  def build(photos)
    groups = Hash.new { |hash, key| hash[key] = [] }
    Array(photos).each { |photo| groups[album_name(photo)] << photo }

    used = Hash.new(0)
    albums = groups.map do |name, items|
      sorted = items.sort_by { |photo| photo['uploaded'].to_s }.reverse
      newest = sorted.first
      oldest = sorted.last
      thumb = newest.dig('variants', 'thumbnail') || newest.dig('variants', 'original') || {}
      base = album_slug(name)
      used[base] += 1
      slug = used[base] == 1 ? base : "#{base}-#{used[base]}"
      {
        'name' => name,
        'slug' => slug,
        'count' => sorted.length,
        'newest' => newest && newest['uploaded'],
        'oldest' => oldest && oldest['uploaded'],
        'cover' => {
          'id' => newest && newest['id'],
          'src' => thumb['src'],
          'width' => thumb['width'],
          'height' => thumb['height'],
          'alt' => newest.dig('meta', 'alt') || name
        }
      }
    end

    albums.sort_by! { |album| album['newest'].to_s }
    albums.reverse!

    slugs = albums.to_h { |album| [album['name'], album['slug']] }
    search = Array(photos).map do |photo|
      name = album_name(photo)
      filename = photo.dig('source', 'filename') || photo['id']
      thumb = photo.dig('variants', 'thumbnail') || {}
      {
        'id' => photo['id'],
        'slug' => slugs[name],
        'text' => [name, filename, photo['id']].compact.join(' ').downcase,
        'title' => filename,
        'subtitle' => name,
        'thumb' => thumb['src'],
        'label' => photo.dig('meta', 'alt') || [filename, name].compact.join(' · ')
      }
    end

    [albums, search]
  end

  class AlbumPage < Jekyll::PageWithoutAFile
    def initialize(site, album)
      super(site, site.source, File.join('photos', album['slug']), 'index.html')
      self.data = {
        'layout' => 'photo-album',
        'type' => 'photos',
        'photos_view' => 'album',
        'title' => album['name'],
        'album' => album['name'],
        'album_slug' => album['slug'],
        'has_open_heart' => true,
        'permalink' => "/photos/#{album['slug']}/"
      }
      self.content = ''
    end
  end

  class SearchPage < Jekyll::PageWithoutAFile
    def initialize(site, items)
      super(site, site.source, 'photos', 'search.json')
      self.data = {
        'layout' => nil,
        'permalink' => '/photos/search.json',
        'sitemap' => false
      }
      self.content = JSON.generate(items)
    end
  end

  class Generator < Jekyll::Generator
    safe true
    priority :low

    def generate(site)
      albums, search = PhotoAlbums.build(site.data['photos'])
      site.data['photo_albums'] = albums
      albums.each { |album| site.pages << AlbumPage.new(site, album) }
      site.pages << SearchPage.new(site, search)
    end
  end
end
