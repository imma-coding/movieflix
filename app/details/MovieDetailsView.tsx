import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { emitDownloadEvent } from '../../lib/downloadEvents';
import { ensureDownloadDir, guessFileExtension, persistDownloadRecord } from '../../lib/fileUtils';
import { downloadHlsPlaylist } from '../../lib/hlsDownloader';
import { scrapeImdbTrailer as scrapeIMDbTrailer } from '../../src/providers/scrapeImdbTrailer';
import { usePStream } from '../../src/pstream/usePStream';

import { CastMember, Media } from '../../types';
import CastList from './CastList';
import EpisodeList from './EpisodeList';
import MovieHeader from './MovieHeader';
import MovieInfo from './MovieInfo';
import RelatedMovies from './RelatedMovies';
import TrailerList from './TrailerList';

interface VideoType {
  key: string;
  name: string;
}

interface Props {
  movie: Media | null;
  trailers: VideoType[];
  relatedMovies: Media[];
  isLoading: boolean;
  onWatchTrailer: (key?: string) => void;
  onBack: () => void;
  onSelectRelated: (id: number) => void;
  onAddToMyList: (movie: Media) => void;
  onOpenChatSheet: () => void;
  seasons: any[];
  mediaType?: string | string[] | undefined;
  cast: CastMember[];
}

const MovieDetailsView: React.FC<Props> = ({
  movie,
  trailers,
  relatedMovies,
  isLoading,
  onWatchTrailer,
  onBack,
  onSelectRelated,
  onAddToMyList,
  onOpenChatSheet,
  seasons,
  mediaType,
  cast,
}) => {
  const [imdbTrailerUrl, setIMDbTrailerUrl] = useState<string | null>(null);
  const [autoPlayed, setAutoPlayed] = useState(false);
  const autoPlayTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const normalizedMediaType: 'movie' | 'tv' = typeof mediaType === 'string' && mediaType === 'tv' ? 'tv' : 'movie';
  const [isLaunchingPlayer, setIsLaunchingPlayer] = React.useState(false);
  const { scrape: scrapeDownload } = usePStream();
  // Auto-fetch IMDb trailer and auto-play after a delay
  useEffect(() => {
    setIMDbTrailerUrl(null);
    setAutoPlayed(false);
    if (!movie || !movie.imdb_id) return;
    let cancelled = false;
    scrapeIMDbTrailer({ imdb_id: movie.imdb_id })
      .then((url) => {
        if (!cancelled && url) {
          setIMDbTrailerUrl(url);
          // Auto-play after 2 seconds if not already played
          if (!autoPlayed) {
            autoPlayTimeout.current = setTimeout(() => {
              setAutoPlayed(true);
              // You can trigger your video player modal here, or call onWatchTrailer with the direct URL
              if (url) {
              // If you have a handler for direct video URLs, use it here
              // For now, fallback to onWatchTrailer if it accepts a URL
                if (typeof onWatchTrailer === 'function' && url) onWatchTrailer(url);
              }
            }, 2000);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (autoPlayTimeout.current) clearTimeout(autoPlayTimeout.current);
    };
  }, [movie?.imdb_id]);
  const [downloadState, setDownloadState] = React.useState<'idle' | 'preparing' | 'downloading'>('idle');
  const [downloadProgress, setDownloadProgress] = React.useState(0);
  const [episodeDownloads, setEpisodeDownloads] = React.useState<Record<string, { state: 'idle' | 'preparing' | 'downloading' | 'completed' | 'error'; progress: number; error?: string }>>({});
  const isMountedRef = React.useRef(true);
  const downloadResumableRef = React.useRef<FileSystem.DownloadResumable | null>(null);
  const contentHint = React.useMemo(() => determineContentHint(movie), [movie]);
  const releaseDateValue = React.useMemo(() => {
    if (!movie) return undefined;
    return movie.release_date || movie.first_air_date || undefined;
  }, [movie]);
  const runtimeMinutes = React.useMemo(() => {
    if (!movie) return undefined;
    const directRuntime = (movie as any)?.runtime;
    if (typeof directRuntime === 'number' && directRuntime > 0) {
      return directRuntime;
    }
    const episodeRunTimes = (movie as any)?.episode_run_time;
    if (Array.isArray(episodeRunTimes) && episodeRunTimes.length > 0) {
      const candidate = episodeRunTimes.find((value: any) => typeof value === 'number' && value > 0);
      if (typeof candidate === 'number') {
        return candidate;
      }
    }
    return undefined;
  }, [movie]);
  const derivedGenreIds = React.useMemo(() => {
    if (!movie) return [];
    if (Array.isArray((movie as any).genre_ids)) return (movie as any).genre_ids;
    if (Array.isArray((movie as any).genres)) return (movie as any).genres.map((g: any) => g.id).filter(Boolean);
    return [];
  }, [movie]);
  React.useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setDownloadStateSafe = React.useCallback((nextState: 'idle' | 'preparing' | 'downloading') => {
    if (isMountedRef.current) {
      setDownloadState(nextState);
    }
  }, []);

  const setDownloadProgressSafe = React.useCallback((nextProgress: number) => {
    if (isMountedRef.current) {
      setDownloadProgress(nextProgress);
    }
  }, []);

  const setEpisodeDownloadState = React.useCallback((episodeId: string, next: { state: 'idle' | 'preparing' | 'downloading' | 'completed' | 'error'; progress: number; error?: string }) => {
    setEpisodeDownloads((prev) => ({ ...prev, [episodeId]: next }));
  }, []);

  const buildUpcomingEpisodesPayload = () => {
    if (mediaType !== 'tv' || !Array.isArray(seasons) || seasons.length === 0) {
      return undefined;
    }
const upcoming: Array<{
  id?: number;
  title?: string;
  seasonName?: string;
  seasonNumber?: number;
  seasonTmdbId?: number;
  episodeNumber?: number;
  episodeTmdbId?: number;
  overview?: string;
  runtime?: number;
  stillPath?: string | null;
  seasonEpisodeCount?: number;
}> = [];


    seasons.forEach((season, idx) => {
      const seasonEpisodes = Array.isArray((season as any)?.episodes) ? (season as any).episodes : [];
      const filtered = idx === 0 ? seasonEpisodes.filter((ep: any) => ep.episode_number > 1) : seasonEpisodes;
      filtered.forEach((ep: any) => {
        upcoming.push({
          id: ep.id,
          title: ep.name,
          seasonName: season?.name ?? `Season ${idx + 1}`,
          episodeNumber: ep.episode_number,
          overview: ep.overview,
          runtime: ep.runtime,
          stillPath: ep.still_path,
          seasonNumber: season?.season_number ?? idx + 1,
          seasonTmdbId: season?.id,
          episodeTmdbId: ep?.id,
          seasonEpisodeCount: seasonEpisodes.length || undefined,
        });
      });
    });

    if (!upcoming.length) return undefined;
    return JSON.stringify(upcoming);
  };

  const findInitialEpisode = () => {
    if (mediaType !== 'tv' || !Array.isArray(seasons)) return null;
    const sortedSeasons = seasons
      .filter((season: any) => typeof season?.season_number === 'number' && season.season_number > 0)
      .sort((a: any, b: any) => a.season_number - b.season_number);
    for (const season of sortedSeasons) {
      const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
      const sortedEpisodes = episodes
        .filter((ep: any) => typeof ep?.episode_number === 'number')
        .sort((a: any, b: any) => a.episode_number - b.episode_number);
      if (sortedEpisodes.length > 0) {
        return {
          season,
          episode: sortedEpisodes[0],
        };
      }
    }
    return null;
  };

  const computeReleaseYear = () => {
    const raw = movie?.release_date || movie?.first_air_date;
    if (!raw) return undefined;
    const parsed = parseInt(raw.slice(0, 4), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const buildDownloadPayload = () => {
    if (!movie) return null;
    const fallbackYear = computeReleaseYear() ?? new Date().getFullYear();
    if (normalizedMediaType === 'tv') {
      const initialEpisode = findInitialEpisode();
      if (!initialEpisode) {
        return null;
      }
      return {
        type: 'show' as const,
        title: movie.name || movie.title || 'TV Show',
        tmdbId: movie.id?.toString() ?? '',
        imdbId: movie.imdb_id ?? undefined,
        releaseYear: fallbackYear,
        season: {
          number: initialEpisode.season.season_number ?? 1,
          tmdbId: initialEpisode.season.id?.toString() ?? '',
          title: initialEpisode.season.name ?? `Season ${initialEpisode.season.season_number ?? 1}`,
          episodeCount: Array.isArray(initialEpisode.season?.episodes)
            ? initialEpisode.season.episodes.length
            : undefined,
        },
        episode: {
          number: initialEpisode.episode.episode_number ?? 1,
          tmdbId: initialEpisode.episode.id?.toString() ?? '',
        },
      };
    }
    return {
      type: 'movie' as const,
      title: movie.title || movie.name || 'Movie',
      tmdbId: movie.id?.toString() ?? '',
      imdbId: movie.imdb_id ?? undefined,
      releaseYear: fallbackYear,
    };
  };

  const buildRouteParams = (targetMediaType: string) => {
    const releaseYear = computeReleaseYear() ?? new Date().getFullYear();
    const params: Record<string, string> = {
      title: movie?.title || movie?.name || 'Now Playing',
      mediaType: targetMediaType,
      tmdbId: movie?.id?.toString() ?? '',
      releaseYear: releaseYear.toString(),
    };
    if (movie?.poster_path) {
      params.posterPath = movie.poster_path;
    }
    if (movie?.backdrop_path) {
      params.backdropPath = movie.backdrop_path;
    }
    if (movie?.overview) {
      params.overview = movie.overview;
    }
    if (releaseDateValue) {
      params.releaseDate = releaseDateValue;
    }
    if (typeof movie?.vote_average === 'number') {
      params.voteAverage = movie.vote_average.toString();
    }
    if (typeof runtimeMinutes === 'number' && runtimeMinutes > 0) {
      params.runtime = runtimeMinutes.toString();
    }
    if (derivedGenreIds.length > 0) {
      params.genreIds = derivedGenreIds.join(',');
    }
    if (movie?.imdb_id) {
      params.imdbId = movie.imdb_id;
    }
    const upcomingEpisodesPayload = buildUpcomingEpisodesPayload();
    if (upcomingEpisodesPayload) {
      params.upcomingEpisodes = upcomingEpisodesPayload;
    }
    return { params, releaseYear };
  };

  const handlePlayMovie = () => {
    if (!movie || isLaunchingPlayer) return;
    const { params } = buildRouteParams(normalizedMediaType);
    setIsLaunchingPlayer(true);

    try {
      if (normalizedMediaType === 'tv') {
        const initialEpisode = findInitialEpisode();
        if (!initialEpisode) {
          Alert.alert('Episodes loading', 'Please wait while we fetch the first episode details.');
          return;
        }
        params.seasonNumber = initialEpisode.season.season_number?.toString() ?? '';
        params.seasonTmdbId = initialEpisode.season.id?.toString() ?? '';
        params.episodeNumber = initialEpisode.episode.episode_number?.toString() ?? '';
        params.episodeTmdbId = initialEpisode.episode.id?.toString() ?? '';
        if (initialEpisode.season?.name) {
          params.seasonTitle = initialEpisode.season.name;
        }
        const episodeCount = Array.isArray(initialEpisode.season?.episodes)
          ? initialEpisode.season.episodes.length
          : undefined;
        if (typeof episodeCount === 'number' && episodeCount > 0) {
          params.seasonEpisodeCount = episodeCount.toString();
        }
      }
      if (contentHint) {
        params.contentHint = contentHint;
      }

      router.push({
        pathname: '/video-player',
        params,
      });
    } finally {
      setIsLaunchingPlayer(false);
    }
  };

  const handlePlayEpisode = (episode: any, season: any) => {
    if (!movie || !season) return;
    const { params } = buildRouteParams('tv');
    const seasonNumber = season?.season_number ?? episode?.season_number ?? 1;
    const episodeNumber = episode?.episode_number ?? 1;

    params.seasonNumber = seasonNumber.toString();
    if (season?.id) params.seasonTmdbId = season.id.toString();
    params.episodeNumber = episodeNumber.toString();
    if (episode?.id) params.episodeTmdbId = episode.id.toString();
    if (season?.name) params.seasonTitle = season.name;
    const episodeCount = Array.isArray(season?.episodes) ? season.episodes.length : undefined;
    if (typeof episodeCount === 'number' && episodeCount > 0) {
      params.seasonEpisodeCount = episodeCount.toString();
    }
    if (contentHint) {
      params.contentHint = contentHint;
    }

    router.push({
      pathname: '/video-player',
      params,
    });
  };

  const handleDownloadEpisode = async (episode: any, season: any) => {
    if (!movie || downloadState !== 'idle') return;
    if (!episode || !season) {
      Alert.alert('Download unavailable', 'Episode information is missing.');
      return;
    }

    const payload = {
      type: 'show' as const,
      title: movie.name || movie.title || 'TV Show',
      tmdbId: movie.id?.toString() ?? '',
      imdbId: movie.imdb_id ?? undefined,
      releaseYear: computeReleaseYear() ?? new Date().getFullYear(),
      season: {
        number: season.season_number ?? season.seasonNumber ?? 1,
        tmdbId: season.id?.toString() ?? '',
        title: season.name ?? `Season ${season.season_number ?? 1}`,
        episodeCount: Array.isArray(season?.episodes) ? season.episodes.length : undefined,
      },
      episode: {
        number: episode.episode_number ?? 1,
        tmdbId: episode.id?.toString() ?? '',
      },
    };

    const title = payload.title;
    const sessionId = `${movie.id ?? 'title'}-${payload.season.number}-${payload.episode.number}-${Date.now()}`;
    const episodeLabel = `S${String(payload.season.number).padStart(2, '0')}E${String(payload.episode.number).padStart(2, '0')}`;
    const subtitleParts = ['Episode', episodeLabel, runtimeMinutes ? `${runtimeMinutes}m` : null].filter(Boolean);
    const subtitle = subtitleParts.length ? subtitleParts.join(' • ') : null;
    const baseEvent = {
      sessionId,
      title,
      mediaId: movie.id ?? undefined,
      mediaType: normalizedMediaType,
      subtitle,
      runtimeMinutes,
      seasonNumber: payload.season.number,
      episodeNumber: payload.episode.number,
    };

    emitDownloadEvent({
      ...baseEvent,
      status: 'preparing',
      progress: 0,
    });

    let cleanupPath: string | null = null;
    try {
      setDownloadStateSafe('preparing');
      setDownloadProgressSafe(0);
      const playback = await scrapeDownload(payload, { debugTag: `[download-episode] ${title}` });
      const downloadsRoot = await ensureDownloadDir();

      const epKey = String(episode.id ?? payload.episode.tmdbId ?? `${payload.season.number}-${payload.episode.number}`);

      if (playback.stream.type === 'hls') {
        const sessionName = `${movie.id ?? 'title'}-s${payload.season.number}-e${payload.episode.number}-${Date.now()}`;
        cleanupPath = `${downloadsRoot}/${sessionName}`;
        setDownloadStateSafe('downloading');
        setEpisodeDownloadState(epKey, { state: 'preparing', progress: 0 });
const hlsResult = await downloadHlsPlaylist({
  playlistUrl: playback.uri,
  headers: playback.headers,
  rootDir: downloadsRoot,
  sessionName,
  onProgress: (completed, total) => {
    if (total > 0) {
      const progress = completed / total;
      setDownloadProgressSafe(progress);
      setEpisodeDownloadState(epKey, { state: 'downloading', progress });
      emitDownloadEvent({
        ...baseEvent,
        status: 'downloading',
        progress,
      });
    }
  },
});

// Ensure hlsResult is not null before accessing
if (!hlsResult) throw new Error('HLS download failed or returned null');

await persistDownloadRecord({
  mediaId: movie.id,
  title,
  mediaType: normalizedMediaType,
  localUri: hlsResult.playlistPath,
  containerPath: hlsResult.directory,
  createdAt: Date.now(),
  bytesWritten: hlsResult.totalBytes,
  runtimeMinutes,
  releaseDate: releaseDateValue,
  posterPath: movie.poster_path,
  backdropPath: movie.backdrop_path,
  overview: movie.overview ?? null,
  seasonNumber: payload.season.number,
  episodeNumber: payload.episode.number,
  sourceUrl: playback.uri,
  downloadType: 'hls',
  segmentCount: hlsResult.segmentCount,
});

        setEpisodeDownloadState(epKey, { state: 'completed', progress: 1 });
        emitDownloadEvent({
          ...baseEvent,
          status: 'completed',
          progress: 1,
        });
      } else {
        const extension = guessFileExtension(playback.uri);
        const suffix = `s${String(payload.season.number).padStart(2, '0')}e${String(payload.episode.number).padStart(2, '0')}`;
        const fileName = `${movie.id ?? 'title'}-${suffix}-${Date.now()}.${extension}`;
        const destination = `${downloadsRoot}/${fileName}`;
        cleanupPath = destination;
        setDownloadStateSafe('downloading');
        setEpisodeDownloadState(epKey, { state: 'preparing', progress: 0 });
        const resumable = FileSystem.createDownloadResumable(
          playback.uri,
          destination,
          playback.headers ? { headers: playback.headers } : undefined,
          (progress) => {
            if (progress.totalBytesExpectedToWrite > 0) {
              const ratio = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
              setDownloadProgressSafe(ratio);
              setEpisodeDownloadState(epKey, { state: 'downloading', progress: ratio });
              emitDownloadEvent({
                ...baseEvent,
                status: 'downloading',
                progress: ratio,
              });
            }
          },
        );
        downloadResumableRef.current = resumable;
        const downloadResult = await resumable.downloadAsync();
        downloadResumableRef.current = null;
        if (!downloadResult || downloadResult.status >= 400) {
          throw new Error('Download did not complete. Please try again.');
        }
        cleanupPath = null;
       const fileInfo = await FileSystem.getInfoAsync(destination);
        await persistDownloadRecord({
          mediaId: movie.id,
          title,
          mediaType: normalizedMediaType,
          localUri: downloadResult.uri,
          containerPath: destination,
          createdAt: Date.now(),
          bytesWritten: fileInfo.exists ? fileInfo.size : undefined,
          runtimeMinutes,
          releaseDate: releaseDateValue,
          posterPath: movie.poster_path,
          backdropPath: movie.backdrop_path,
          overview: movie.overview ?? null,
          seasonNumber: payload.season.number,
          episodeNumber: payload.episode.number,
          sourceUrl: playback.uri,
          downloadType: 'file',
        });
        setEpisodeDownloadState(epKey, { state: 'completed', progress: 1 });
        emitDownloadEvent({
          ...baseEvent,
          status: 'completed',
          progress: 1,
        });
      }
      setDownloadStateSafe('idle');
      setDownloadProgressSafe(0);
      if (isMountedRef.current) {
        Alert.alert('Download complete', `${title} ${episodeLabel} is now available offline.`, [
          { text: 'OK', style: 'default' },
          { text: 'Go to downloads', onPress: () => router.push('/downloads') },
        ]);
      }
    } catch (err: any) {
      console.error('Episode download failed', err);
      const epId = payload.episode.tmdbId ?? `${payload.season.number}-${payload.episode.number}`;
      setEpisodeDownloadState(epId, { state: 'error', progress: 0, error: err?.message ?? String(err) });
      if (isMountedRef.current) {
        Alert.alert('Download failed', err?.message || 'Unable to save this episode for offline viewing right now.');
      }
      setDownloadStateSafe('idle');
      setDownloadProgressSafe(0);
      downloadResumableRef.current = null;
      if (cleanupPath) {
        FileSystem.deleteAsync(cleanupPath, { idempotent: true }).catch(() => {});
      }
      emitDownloadEvent({
        ...baseEvent,
        status: 'error',
        progress: 0,
        errorMessage: err?.message || 'Download failed',
      });
    }
  };

  const handleDownload = async () => {
    if (!movie || downloadState !== 'idle') return;
    const payload = buildDownloadPayload();
    if (!payload) {
      Alert.alert('Download unavailable', 'We could not find an episode to download yet.');
      return;
    }
    const title = movie.title || movie.name || 'Download';
    const sessionId = `${movie.id ?? 'title'}-${Date.now()}`;
    const episodeLabel =
      payload.type === 'show'
        ? `S${String(payload.season.number).padStart(2, '0')}E${String(payload.episode.number).padStart(2, '0')}`
        : null;
    const subtitleParts = [
      payload.type === 'show' ? 'Episode' : 'Movie',
      episodeLabel,
      runtimeMinutes ? `${runtimeMinutes}m` : null,
    ].filter(Boolean);
    const subtitle = subtitleParts.length ? subtitleParts.join(' • ') : null;
    const baseEvent = {
      sessionId,
      title,
      mediaId: movie.id ?? undefined,
      mediaType: normalizedMediaType,
      subtitle,
      runtimeMinutes,
      seasonNumber: payload.type === 'show' ? payload.season.number : undefined,
      episodeNumber: payload.type === 'show' ? payload.episode.number : undefined,
    };
    emitDownloadEvent({
      ...baseEvent,
      status: 'preparing',
      progress: 0,
    });
    let cleanupPath: string | null = null;
    try {
      setDownloadStateSafe('preparing');
      setDownloadProgressSafe(0);
      const playback = await scrapeDownload(payload, { debugTag: `[download] ${title}` });
      const downloadsRoot = await ensureDownloadDir();

      if (playback.stream.type === 'hls') {
        const sessionName = `${movie.id ?? 'title'}-${Date.now()}`;
        cleanupPath = `${downloadsRoot}/${sessionName}`;
        setDownloadStateSafe('downloading');
const hlsResult = await downloadHlsPlaylist({
  playlistUrl: playback.uri,
  headers: playback.headers,
  rootDir: downloadsRoot,
  sessionName,
  onProgress: (completed, total) => {
    if (total > 0) {
      const progress = completed / total;
      setDownloadProgressSafe(progress);
      emitDownloadEvent({
        ...baseEvent,
        status: 'downloading',
        progress,
      });
    }
  },
});

// Ensure hlsResult is not null
if (!hlsResult) throw new Error('HLS download failed or returned null');

  await persistDownloadRecord({
  mediaId: movie.id,
  title,
  mediaType: normalizedMediaType,
  localUri: hlsResult.playlistPath,
  containerPath: hlsResult.directory,
  createdAt: Date.now(),
  bytesWritten: hlsResult.totalBytes,
  runtimeMinutes,
  releaseDate: releaseDateValue,
  posterPath: movie.poster_path,
  backdropPath: movie.backdrop_path,
  overview: movie.overview ?? null,
  seasonNumber: payload.type === 'show' ? payload.season.number : undefined,
  episodeNumber: payload.type === 'show' ? payload.episode.number : undefined,
  sourceUrl: playback.uri,
  downloadType: 'hls',
  segmentCount: hlsResult.segmentCount,
});

        emitDownloadEvent({
          ...baseEvent,
          status: 'completed',
          progress: 1,
        });
      } else {
        const extension = guessFileExtension(playback.uri);
        const suffix =
          payload.type === 'show'
            ? `s${String(payload.season.number).padStart(2, '0')}e${String(payload.episode.number).padStart(2, '0')}`
            : 'movie';
        const fileName = `${movie.id ?? 'title'}-${suffix}-${Date.now()}.${extension}`;
        const destination = `${downloadsRoot}/${fileName}`;
        cleanupPath = destination;
        setDownloadStateSafe('downloading');
        const resumable = FileSystem.createDownloadResumable(
          playback.uri,
          destination,
          playback.headers ? { headers: playback.headers } : undefined,
          (progress) => {
            if (progress.totalBytesExpectedToWrite > 0) {
              const ratio = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
              setDownloadProgressSafe(ratio);
              emitDownloadEvent({
                ...baseEvent,
                status: 'downloading',
                progress: ratio,
              });
            }
          },
        );
        downloadResumableRef.current = resumable;
        const downloadResult = await resumable.downloadAsync();
        downloadResumableRef.current = null;
        if (!downloadResult || downloadResult.status >= 400) {
          throw new Error('Download did not complete. Please try again.');
        }
        cleanupPath = null;
       const fileInfo = await FileSystem.getInfoAsync(destination); 
        await persistDownloadRecord({
          mediaId: movie.id,
          title,
          mediaType: normalizedMediaType,
          localUri: downloadResult.uri,
          containerPath: destination,
          createdAt: Date.now(),
          bytesWritten: fileInfo.exists ? fileInfo.size : undefined,
          runtimeMinutes,
          releaseDate: releaseDateValue,
          posterPath: movie.poster_path,
          backdropPath: movie.backdrop_path,
          overview: movie.overview ?? null,
          seasonNumber: payload.type === 'show' ? payload.season.number : undefined,
          episodeNumber: payload.type === 'show' ? payload.episode.number : undefined,
          sourceUrl: playback.uri,
          downloadType: 'file',
        });
        emitDownloadEvent({
          ...baseEvent,
          status: 'completed',
          progress: 1,
        });
      }
      setDownloadStateSafe('idle');
      setDownloadProgressSafe(0);
      if (isMountedRef.current) {
        Alert.alert('Download complete', `${title} is now available offline.`, [
          { text: 'OK', style: 'default' },
          {
            text: 'Go to downloads',
            onPress: () => router.push('/downloads'),
          },
        ]);
      }
    } catch (err: any) {
      console.error('Download failed', err);
      if (isMountedRef.current) {
        Alert.alert('Download failed', err?.message || 'Unable to save this title for offline viewing right now.');
      }
      setDownloadStateSafe('idle');
      setDownloadProgressSafe(0);
      downloadResumableRef.current = null;
      if (cleanupPath) {
        FileSystem.deleteAsync(cleanupPath, { idempotent: true }).catch(() => {});
      }
      emitDownloadEvent({
        ...baseEvent,
        status: 'error',
        progress: 0,
        errorMessage: err?.message || 'Download failed',
      });
    }
  };

  return (
    <View style={styles.fullContainer}>
      <ScrollView contentContainerStyle={styles.scrollViewContent} showsVerticalScrollIndicator={false}>
        <MovieHeader
          movie={movie}
          isLoading={isLoading}
          onWatchTrailer={onWatchTrailer}
          onBack={onBack}
          onAddToMyList={() => movie && onAddToMyList(movie)}
          onPlayMovie={handlePlayMovie}
          isPStreamPlaying={false}
          accentColor="#e50914"
          isPlayLoading={isLaunchingPlayer}
          onDownload={handleDownload}
          downloadStatus={downloadState}
          downloadProgress={downloadState === 'downloading' ? downloadProgress : null}
        />
        {/* Discuss button for movie group chat */}
        {movie && (
          <TouchableOpacity
            style={{ margin: 16, padding: 12, backgroundColor: '#222', borderRadius: 8, alignItems: 'center' }}
            onPress={onOpenChatSheet}

            accessibilityLabel="Discuss this movie"
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Discuss this Movie</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.section, styles.sectionFirst]}>
          <MovieInfo movie={movie} isLoading={isLoading} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trailers</Text>
          <TrailerList trailers={trailers} isLoading={isLoading} onWatchTrailer={onWatchTrailer} />
        </View>

        {mediaType === 'tv' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Episodes</Text>
            <EpisodeList
              seasons={seasons}
              onPlayEpisode={handlePlayEpisode}
              onDownloadEpisode={handleDownloadEpisode}
              disabled={isLoading || isLaunchingPlayer}
              episodeDownloads={episodeDownloads}
            />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>More like this</Text>
          <RelatedMovies
            relatedMovies={relatedMovies}
            isLoading={isLoading}
            onSelectRelated={onSelectRelated}
          />
        </View>

        <View style={[styles.section, styles.lastSection]}>
          <Text style={styles.sectionTitle}>Cast</Text>
          <CastList cast={cast} />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  fullContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollViewContent: {
    paddingBottom: 40,
    paddingTop: 0,
  },
  section: {
    paddingHorizontal: 18,
    marginTop: 16,
  },
  sectionFirst: {
    marginTop: -12,
  },
  lastSection: {
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#f5f5f5',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
});

export default MovieDetailsView;

function determineContentHint(media?: Media | null): string | undefined {
  if (!media) return undefined;
  const genreIds = Array.isArray(media.genre_ids) ? media.genre_ids : [];
  const explicitGenres: string[] = Array.isArray((media as any)?.genres)
    ? (media as any).genres.map((g: any) => (g?.name || '').toLowerCase())
    : [];
  const originCountries: string[] = Array.isArray((media as any)?.origin_country)
    ? (media as any).origin_country
    : [];
  const originalLanguage = (media as any)?.original_language;
  const titleCheck = `${media.title || ''} ${media.name || ''}`.toLowerCase();
  const ANIMATION_GENRE_ID = 16;
  if (
    genreIds.includes(ANIMATION_GENRE_ID) ||
    explicitGenres.some(name => name.includes('animation') || name.includes('anime')) ||
    originCountries.includes('JP') ||
    originalLanguage === 'ja' ||
    titleCheck.includes('anime')
  ) {
    return 'anime';
  }
  return undefined;
}
