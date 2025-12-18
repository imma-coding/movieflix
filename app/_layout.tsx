
// app/_layout.tsx
import '@react-native-anywhere/polyfill-base64';
import * as Linking from 'expo-linking';
import { Stack, router } from 'expo-router';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-get-random-values';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-url-polyfill/auto';
// URL.parse polyfill for p-stream providers
import '../polyfills/url';
import { supabase } from '../constants/supabase';
import { CustomThemeProvider } from '../hooks/use-theme';
import { SubscriptionProvider } from '../providers/SubscriptionProvider';
import { AccentProvider } from './components/AccentContext';

export default function RootLayout() {
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const redirectUrl = Linking.createURL('/post-review');
      // Supabase types sometimes miss getSessionFromUrl in certain versions; cast to any for now.
      const { data, error } = await (supabase.auth as any).getSessionFromUrl(event.url, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.warn('Deep link handling failed:', error);
        return;
      }

      if (data.session) {
        router.replace('/post-review');
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Clean up the subscription when the component unmounts
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0E0E0E' }}>
      <SafeAreaProvider>
        <CustomThemeProvider>
          <AccentProvider>
            <SubscriptionProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="select-profile" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="post-review" />
                <Stack.Screen
                  name="calls/[id]"
                  options={{
                    headerShown: false,
                    presentation: 'fullScreenModal',
                  }}
                />
              </Stack>
            </SubscriptionProvider>
        </AccentProvider>
      </CustomThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
  );
}
