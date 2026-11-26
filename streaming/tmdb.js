// TMDB API client for the main process. Requires a free API key from themoviedb.org.
const { net } = require('electron');
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

let apiKey = '';

function setKey(key) { apiKey = key; }
function getKey() { return apiKey; }

async function api(path, params = {}) {
  if (!apiKey) throw new Error('TMDB API key not set. Get a free key at themoviedb.org/settings/api');
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await net.fetch(url.href);
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`);
  return res.json();
}

function img(path, size = 'w500') {
  return path ? `${IMG}/${size}${path}` : null;
}

// Shared result normalizer: turns TMDB's movie/tv/person objects into a uniform shape.
function normalize(item, type) {
  const t = type || item.media_type || (item.title ? 'movie' : item.name ? 'tv' : 'unknown');
  return {
    id: item.id,
    type: t,
    title: item.title || item.name || '',
    originalTitle: item.original_title || item.original_name || '',
    overview: item.overview || '',
    poster: img(item.poster_path, 'w342'),
    backdrop: img(item.backdrop_path, 'w1280'),
    rating: item.vote_average || 0,
    votes: item.vote_count || 0,
    popularity: item.popularity || 0,
    date: item.release_date || item.first_air_date || '',
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    genreIds: item.genre_ids || (item.genres || []).map(g => g.id),
    language: item.original_language || '',
  };
}

// ---------- discovery ----------
async function trending(type = 'all', window = 'week', page = 1) {
  const data = await api(`/trending/${type}/${window}`, { page });
  return { page: data.page, totalPages: data.total_pages, results: data.results.map(r => normalize(r)) };
}

async function popular(type = 'movie', page = 1) {
  const data = await api(`/${type}/popular`, { page });
  return { page: data.page, totalPages: data.total_pages, results: data.results.map(r => normalize(r, type)) };
}

async function topRated(type = 'movie', page = 1) {
  const data = await api(`/${type}/top_rated`, { page });
  return { page: data.page, totalPages: data.total_pages, results: data.results.map(r => normalize(r, type)) };
}

async function nowPlaying(page = 1) {
  const data = await api('/movie/now_playing', { page });
  return { page: data.page, totalPages: data.total_pages, results: data.results.map(r => normalize(r, 'movie')) };
}

async function airingToday(page = 1) {
  const data = await api('/tv/airing_today', { page });
  return { page: data.page, totalPages: data.total_pages, results: data.results.map(r => normalize(r, 'tv')) };
}

// ---------- search ----------
async function search(query, page = 1, type = 'multi') {
  if (!query) return { page: 1, totalPages: 0, results: [] };
  const data = await api(`/search/${type}`, { query, page, include_adult: false });
  return { page: data.page, totalPages: data.total_pages, results: data.results.filter(r => r.media_type !== 'person').map(r => normalize(r, type === 'multi' ? undefined : type)) };
}

// ---------- details ----------
function pickLogo(data) {
  const logos = (data.images && data.images.logos) || [];
  const best = logos.find(l => l.iso_639_1 === 'en') || logos.find(l => !l.iso_639_1) || logos[0];
  return best ? img(best.file_path, 'w500') : null;
}

function pickTrailer(data) {
  const vids = (data.videos?.results || []).filter(v => v.site === 'YouTube');
  const best = vids.find(v => v.type === 'Trailer' && v.official) || vids.find(v => v.type === 'Trailer') || vids.find(v => v.type === 'Teaser');
  return best ? best.key : null;
}

async function movieDetails(id) {
  const data = await api(`/movie/${id}`, { append_to_response: 'credits,videos,recommendations,similar,images', include_image_language: 'en,null' });
  const result = normalize(data, 'movie');
  result.logo = pickLogo(data);
  result.trailer = pickTrailer(data);
  result.runtime = data.runtime || 0;
  result.tagline = data.tagline || '';
  result.genres = (data.genres || []).map(g => g.name);
  result.status = data.status || '';
  result.budget = data.budget || 0;
  result.revenue = data.revenue || 0;
  result.cast = (data.credits?.cast || []).slice(0, 20).map(c => ({ id: c.id, name: c.name, character: c.character, photo: img(c.profile_path, 'w185') }));
  result.crew = (data.credits?.crew || []).filter(c => ['Director', 'Writer', 'Screenplay'].includes(c.job)).map(c => ({ id: c.id, name: c.name, job: c.job }));
  result.videos = (data.videos?.results || []).filter(v => v.site === 'YouTube').map(v => ({ key: v.key, name: v.name, type: v.type }));
  result.recommendations = (data.recommendations?.results || []).slice(0, 12).map(r => normalize(r, 'movie'));
  result.similar = (data.similar?.results || []).slice(0, 12).map(r => normalize(r, 'movie'));
  result.imdbId = data.imdb_id || null;
  return result;
}

async function tvDetails(id) {
  const data = await api(`/tv/${id}`, { append_to_response: 'credits,videos,recommendations,similar,external_ids,images', include_image_language: 'en,null' });
  const result = normalize(data, 'tv');
  result.logo = pickLogo(data);
  result.trailer = pickTrailer(data);
  result.tagline = data.tagline || '';
  result.genres = (data.genres || []).map(g => g.name);
  result.status = data.status || '';
  result.seasons = (data.seasons || []).map(s => ({ number: s.season_number, name: s.name, episodes: s.episode_count, poster: img(s.poster_path, 'w185'), date: s.air_date || '' }));
  result.totalSeasons = data.number_of_seasons || 0;
  result.totalEpisodes = data.number_of_episodes || 0;
  result.episodeRuntime = (data.episode_run_time || [])[0] || 0;
  result.networks = (data.networks || []).map(n => n.name);
  result.cast = (data.credits?.cast || []).slice(0, 20).map(c => ({ id: c.id, name: c.name, character: c.character, photo: img(c.profile_path, 'w185') }));
  result.videos = (data.videos?.results || []).filter(v => v.site === 'YouTube').map(v => ({ key: v.key, name: v.name, type: v.type }));
  result.recommendations = (data.recommendations?.results || []).slice(0, 12).map(r => normalize(r, 'tv'));
  result.similar = (data.similar?.results || []).slice(0, 12).map(r => normalize(r, 'tv'));
  result.imdbId = data.external_ids?.imdb_id || null;
  return result;
}

async function seasonDetails(tvId, seasonNumber) {
  const data = await api(`/tv/${tvId}/season/${seasonNumber}`);
  return {
    id: data.id,
    name: data.name,
    number: data.season_number,
    overview: data.overview || '',
    poster: img(data.poster_path, 'w342'),
    episodes: (data.episodes || []).map(ep => ({
      id: ep.id,
      number: ep.episode_number,
      name: ep.name,
      overview: ep.overview || '',
      still: img(ep.still_path, 'w300'),
      date: ep.air_date || '',
      runtime: ep.runtime || 0,
      rating: ep.vote_average || 0,
    })),
  };
}

// ---------- genres ----------
async function genres(type = 'movie') {
  const data = await api(`/genre/${type}/list`);
  return data.genres || [];
}

async function discover(type = 'movie', params = {}) {
  const data = await api(`/discover/${type}`, { sort_by: 'popularity.desc', ...params });
  return { page: data.page, totalPages: data.total_pages, results: data.results.map(r => normalize(r, type)) };
}

module.exports = { setKey, getKey, api, img, trending, popular, topRated, nowPlaying, airingToday, search, movieDetails, tvDetails, seasonDetails, genres, discover };
