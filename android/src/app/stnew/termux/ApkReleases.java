package app.stnew.termux;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ApkReleases {
    private static final String REPOSITORY = "SuperMIke604/st_new";
    private static final String ASSET = "st-new.apk";
    private static final Pattern TAG = Pattern.compile("apk-v([1-9][0-9]{0,8})");

    static final class Release {
        final int versionCode;
        final String name;
        final String downloadUrl;

        Release(int versionCode, String name, String tag) {
            this.versionCode = versionCode;
            this.name = name.isEmpty() ? tag : name;
            this.downloadUrl = "https://github.com/" + REPOSITORY + "/releases/download/" + tag + "/" + ASSET;
        }
    }

    static Release fetch() throws IOException, JSONException {
        URL url = new URL("https://api.github.com/repos/" + REPOSITORY + "/releases?per_page=30");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "ST-New-Android");
        try {
            int status = connection.getResponseCode();
            if (status != 200) {
                throw new IOException("GitHub HTTP " + status);
            }
            try (InputStream response = connection.getInputStream()) {
                return latestPublished(new JSONArray(readUtf8(response)));
            }
        } finally {
            connection.disconnect();
        }
    }

    static Release latestPublished(JSONArray releases) throws JSONException {
        Release latest = null;
        for (int i = 0; i < releases.length(); i++) {
            JSONObject item = releases.getJSONObject(i);
            String tag = item.optString("tag_name");
            Matcher match = TAG.matcher(tag);
            if (item.optBoolean("draft") || item.optBoolean("prerelease") || !match.matches()) {
                continue;
            }
            int versionCode = Integer.parseInt(match.group(1));
            JSONArray assets = item.getJSONArray("assets");
            for (int j = 0; j < assets.length(); j++) {
                JSONObject asset = assets.getJSONObject(j);
                if (ASSET.equals(asset.optString("name")) && "uploaded".equals(asset.optString("state"))
                        && (latest == null || versionCode > latest.versionCode)) {
                    latest = new Release(versionCode, item.optString("name"), tag);
                }
            }
        }
        return latest;
    }

    static String readUtf8(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }
}
