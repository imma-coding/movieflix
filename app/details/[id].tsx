import React, { useEffect, useState } from 'react';
import {
  StatusBar,
  Modal,
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MovieDetailsView from './MovieDetailsView';
import { API_KEY, API_BASE_URL } from '../../constants/api';
import { Media, CastMember } from '../../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MainVideoPlayer } from '../../components/MainVideoPlayer';
import ScreenWrapper from '../../components/ScreenWrapper';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { getAccentFromPosterPath } from '../../constants/theme';
import { getProfileScopedKey } from '../../lib/profileStorage';
import NewChatSheet from '../messaging/components/NewChatSheet';
import { Profile, findOrCreateConversation, getFollowing } from '../messaging/controller';

interface Video {
  key: string;
  name: string;
  site: string;
  type: string;
}

const ACCENT = '#E50914';

const MovieDetailsContainer: React.FC = () => {
  const { id, mediaType } = useLocalSearchParams();
  const router = useRouter();
  const [movie, setMovie] = useState<Media | null>(null);
  const [trailers, setTrailers] = useState<Video[]>([]);
  const [relatedMovies, setRelatedMovies] = useState<Media[]>([]);
  const [seasons, setSeasons] = useState<any[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [isChatSheetVisible, setIsChatSheetVisible] = useState(false);
  const [following, setFollowing] = useState<Profile[]>([]);
  const accentColor = getAccentFromPosterPath(movie?.poster_path);

  useEffect(() => {
    let mounted = true;
    if (!id || !mediaType) {
      setIsLoading(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoading(true);
      try {
        const [detailsRes, videosRes, relatedRes, creditsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/${mediaType}/${id}?api_key=${API_KEY}&append_to_response=external_ids`),
          fetch(`${API_BASE_URL}/${mediaType}/${id}/videos?api_key=${API_KEY}`),
          fetch(`${API_BASE_URL}/${mediaType}/${id}/recommendations?api_key=${API_KEY}`),
          fetch(`${API_BASE_URL}/${mediaType}/${id}/credits?api_key=${API_KEY}`),
        ]);

        const detailsData = await detailsRes.json();
        const videosData = await videosRes.json();
        const relatedData = await relatedRes.json();
        const creditsData = await creditsRes.json();

        if (!mounted) return;

        const normalizedDetails = detailsData
          ? {
              ...detailsData,
              imdb_id: detailsData.imdb_id ?? detailsData.external_ids?.imdb_id ?? null,
            }
          : null;
        setMovie(normalizedDetails);
        setTrailers(
          (videosData?.results || []).filter(
            (video: Video) => video.site === 'YouTube' && video.type === 'Trailer'
          )
        );
        setRelatedMovies(relatedData?.results || []);
        setCast(creditsData?.cast || []);

        if (mediaType === 'tv' && detailsData.seasons) {
          const seasonsData = await Promise.all(
            detailsData.seasons.map((season: any) =>
              fetch(`${API_BASE_URL}/tv/${id}/season/${season.season_number}?api_key=${API_KEY}`).then(res => res.json())
            )
          );
          if (mounted) {
            setSeasons(seasonsData);
          }
        }

      } catch (error) {
        console.error('Error fetching details:', error);
        if (mounted) {
          setMovie(null);
          setTrailers([]);
          setRelatedMovies([]);
          setSeasons([]);
          setCast([]);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    // small delay to smoothen transitions (keeps same behavior as before)
    const t = setTimeout(fetchDetails, 120);
    return () => {
      mounted = false;
      clearTimeout(t);
    };
  }, [id, mediaType]);

  useEffect(() => {
    const fetchFollowing = async () => {
      try {
        const list = await getFollowing();
        setFollowing(list);
      } catch (e) {
        console.error('Error fetching following list:', e);
        setFollowing([]);
      }
    };
    fetchFollowing();
  }, []);

  const handleOpenChatSheet = () => {
    setIsChatSheetVisible(true);
  };

  const handleCloseChatSheet = () => {
    setIsChatSheetVisible(false);
  };

  const handleStartChat = async (person: Profile) => {
    try {
      const conversationId = await findOrCreateConversation(person);
      setIsChatSheetVisible(false);
      router.push({ pathname: '/messaging/chat/[id]', params: { id: conversationId } });
    } catch (error) {
      console.error('Error starting chat: ', error);
    }
  };

  const handleWatchTrailer = () => {
    setIsVideoVisible(true);
  };

  const handleBack = () => {
    router.back();
  };

  const handleAddToMyList = (movie: Media) => {
    // TODO: implement add to my list
    console.log('Add to my list:', movie);
  };

  const handleSelectRelated = (relatedId: number) => {
    const relatedItem = relatedMovies.find((item) => item.id === relatedId);
    if (relatedItem) {
      router.push(`/details/${relatedId}?mediaType=${relatedItem.media_type}`);
    } else {
      router.push(`/details/${relatedId}?mediaType=movie`);
    }
  };

  return (
    <>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScreenWrapper style={styles.pageWrapper}>
        <LinearGradient
          colors={[accentColor, '#150a13', '#05060f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.backgroundLayer} />
        <MovieDetailsView
          movie={movie}
          trailers={trailers}
          relatedMovies={relatedMovies}
          isLoading={isLoading}
          onWatchTrailer={handleWatchTrailer}
          onBack={handleBack}
          onSelectRelated={handleSelectRelated}
          onAddToMyList={handleAddToMyList}
          seasons={seasons}
          mediaType={mediaType}
          cast={cast}
          onOpenChatSheet={handleOpenChatSheet}
        />
      </ScreenWrapper>

      {/* Trailer Modal — glassy player with a close bar */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={isVideoVisible}
        onRequestClose={() => setIsVideoVisible(false)}
      >
        <LinearGradient
          colors={['#050405', '#120206']}
          style={styles.modalContainer}
          start={[0, 0]}
          end={[1, 1]}
        >
          <BlurView intensity={40} tint="dark" style={styles.modalBlur} />

          {/* top bar with back/close button */}
          <View style={styles.modalTopBar}>
            <TouchableOpacity
              onPress={() => setIsVideoVisible(false)}
              style={styles.modalCloseBtn}
              accessibilityLabel="Close video"
            >
              <Ionicons name="chevron-down" size={28} color="#fff" />
            </TouchableOpacity>

            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalTitle}>{movie?.title || movie?.name || 'Trailer'}</Text>
            </View>

            <View style={{ width: 40 }} />
          </View>

          {/* Player */}
          <View style={styles.playerWrap}>
            {/* keep the MainVideoPlayer usage — swap source as needed */}
            <MainVideoPlayer videoSource="http://d23dyxeqlo5psv.cloudfront.net/big_buck_bunny.mp4" />
          </View>
        </LinearGradient>
      </Modal>

      <NewChatSheet
        isVisible={isChatSheetVisible}
        onClose={handleCloseChatSheet}
        following={following}
        onStartChat={handleStartChat}
        onCreateGroup={() => { /* Not needed for movie details chat for now */ }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  pageWrapper: {
    paddingTop: 0,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,12,20,0.65)',
  },
  accentSheen: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.6,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  modalTopBar: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'absolute',
    top: Platform.OS === 'ios' ? 48 : 24,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modalTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  playerWrap: {
    flex: 1,
    marginTop: 0,
    marginHorizontal: 0,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
});

export default MovieDetailsContainer;
