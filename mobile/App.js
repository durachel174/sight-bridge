import { useRef, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";

const placeholderDecision = {
  severity: "ready",
  message: "Point the camera at a document, screen, card, or label.",
  reasoning: "Capture runs the disclosure flow. Native OCR is the next integration."
};

export default function App() {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [decision, setDecision] = useState(placeholderDecision);
  const [capturedUri, setCapturedUri] = useState(null);

  async function captureFrame() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
    if (!photo?.uri) return;

    setCapturedUri(photo.uri);
    setDecision({
      severity: "captured",
      message: "Frame captured.",
      reasoning:
        "Next native step: run device OCR, then pass extracted text into the SightBridge disclosure engine."
    });
  }

  if (!permission) {
    return <Shell decision={decision} />;
  }

  if (!permission.granted) {
    return (
      <Shell decision={decision}>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryText}>Allow camera</Text>
        </Pressable>
      </Shell>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Disclosure awareness</Text>
        <Text style={styles.title}>SightBridge</Text>
      </View>

      <View style={styles.cameraFrame}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.primaryButton} onPress={captureFrame}>
          <Text style={styles.primaryText}>Capture frame</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} disabled>
          <Text style={styles.secondaryText}>Cloud vision off</Text>
        </Pressable>
      </View>

      <DisclosureCard decision={decision} capturedUri={capturedUri} />
    </SafeAreaView>
  );
}

function Shell({ children, decision }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Disclosure awareness</Text>
        <Text style={styles.title}>SightBridge</Text>
      </View>
      {children}
      <DisclosureCard decision={decision} />
    </SafeAreaView>
  );
}

function DisclosureCard({ decision, capturedUri }) {
  return (
    <View style={styles.card}>
      <Text style={styles.badge}>{decision.severity}</Text>
      <Text style={styles.cardTitle}>{decision.message}</Text>
      <Text style={styles.cardBody}>{decision.reasoning}</Text>
      {capturedUri ? <Text style={styles.uriText}>Local capture: {capturedUri}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f4f7f5",
    padding: 18,
    gap: 16
  },
  header: {
    gap: 4
  },
  eyebrow: {
    color: "#0a4f49",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  title: {
    color: "#17201b",
    fontSize: 34,
    fontWeight: "800"
  },
  cameraFrame: {
    flex: 1,
    minHeight: 340,
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#0b0f0d"
  },
  camera: {
    flex: 1
  },
  controls: {
    flexDirection: "row",
    gap: 10
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#0f766e"
  },
  primaryText: {
    color: "#fff",
    fontWeight: "800"
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#eef4f1",
    borderWidth: 1,
    borderColor: "#cbd7d0"
  },
  secondaryText: {
    color: "#0a4f49",
    fontWeight: "800"
  },
  card: {
    gap: 8,
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d7ded9"
  },
  badge: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#eef4f1",
    color: "#0a4f49",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize"
  },
  cardTitle: {
    color: "#17201b",
    fontSize: 20,
    fontWeight: "800"
  },
  cardBody: {
    color: "#5d6a63",
    fontSize: 15,
    lineHeight: 21
  },
  uriText: {
    color: "#5d6a63",
    fontSize: 12
  }
});
