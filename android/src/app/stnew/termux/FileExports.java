package app.stnew.termux;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

final class FileExports {
    static final int SAVE_FILE = 2;
    private static final String PENDING_FILE = "pendingExport";
    private static final String START = "export-start:";
    private static final String CHUNK = "export-chunk:";
    private static final int CHUNK_SIZE = 48 * 1024;

    private final Activity activity;
    private File stagedFile;
    private FileOutputStream receiving;
    private long remaining;
    private String filename;
    private String mimeType;
    private boolean saving;

    FileExports(Activity activity, Bundle state) {
        this.activity = activity;
        String pending = state == null ? null : state.getString(PENDING_FILE);
        if (pending != null && pending.matches("export-[0-9]+\\.tmp")) {
            stagedFile = new File(activity.getCacheDir(), pending);
        }
    }

    void saveState(Bundle state) {
        if (stagedFile != null && receiving == null) {
            state.putString(PENDING_FILE, stagedFile.getName());
        }
    }

    void onMessage(WebMessagePort port, String message) {
        boolean ok = false;
        try {
            if ("export-busy".equals(message)) {
                showToast("请先完成当前导出。");
                return;
            } else if (message.startsWith(START)) {
                if (stagedFile != null || saving) {
                    showToast("请先完成当前导出。");
                } else {
                    start(message.substring(START.length()));
                    ok = true;
                }
            } else if (message.startsWith(CHUNK)) {
                append(message.substring(CHUNK.length()));
                ok = true;
            } else if ("export-finish".equals(message)) {
                openPicker();
                ok = true;
            } else if ("export-error".equals(message)) {
                cancelTransfer();
                showToast("读取导出文件失败，请重试。");
                return;
            } else {
                return;
            }
        } catch (ActivityNotFoundException error) {
            discard();
            showToast("找不到系统文件保存界面。");
        } catch (IOException | JSONException | IllegalArgumentException error) {
            cancelTransfer();
            Log.w("ST New", "Unable to prepare file export");
            showToast("无法准备导出文件，请重试。");
        }
        port.postMessage(new WebMessage(ok ? "export-ok" : "export-failed"));
    }

    private void start(String metadata) throws JSONException, IOException {
        JSONObject file = new JSONObject(metadata);
        remaining = file.getLong("size");
        if (remaining < 0) throw new IOException("Invalid export size");
        filename = file.getString("name").replaceAll("[\\p{Cntrl}/\\\\]", "_").trim();
        if (filename.isEmpty() || ".".equals(filename) || "..".equals(filename)) {
            filename = "导出文件";
        }
        mimeType = file.getString("type").split(";", 2)[0].trim();
        if (!mimeType.matches("[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+")) {
            mimeType = "application/octet-stream";
        }
        File temp = File.createTempFile("export-", ".tmp", activity.getCacheDir());
        try {
            receiving = new FileOutputStream(temp);
            stagedFile = temp;
        } catch (IOException error) {
            temp.delete();
            throw error;
        }
    }

    private void append(String encoded) throws IOException {
        if (receiving == null || encoded.length() > CHUNK_SIZE / 3 * 4) {
            throw new IOException("Unexpected export chunk");
        }
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length == 0 || bytes.length > remaining) throw new IOException("Invalid export chunk size");
        receiving.write(bytes);
        remaining -= bytes.length;
    }

    private void openPicker() throws IOException {
        if (receiving == null || remaining != 0) throw new IOException("Incomplete export");
        receiving.close();
        receiving = null;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        activity.startActivityForResult(intent, SAVE_FILE);
    }

    void onActivityResult(int resultCode, Intent data) {
        File source = stagedFile;
        stagedFile = null;
        if (resultCode != Activity.RESULT_OK) {
            if (source != null) source.delete();
            return;
        }
        Uri destination = data == null ? null : data.getData();
        if (destination == null || !"content".equals(destination.getScheme())) {
            if (source != null) source.delete();
            showToast("无法打开选定的保存位置，请重新导出。");
            return;
        }
        saving = true;
        new Thread(() -> {
            boolean saved = writeFile(source, destination);
            activity.runOnUiThread(() -> {
                saving = false;
                if (!activity.isDestroyed()) {
                    showToast(saved ? "文件已保存。" : "保存文件失败，请重试。");
                }
            });
        }, "file-export").start();
    }

    private boolean writeFile(File source, Uri destination) {
        ContentResolver resolver = activity.getContentResolver();
        try {
            if (source == null) throw new IOException("Missing staged export");
            try (FileInputStream input = new FileInputStream(source);
                 OutputStream output = resolver.openOutputStream(destination, "w")) {
                if (output == null) throw new IOException("Destination unavailable");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            return true;
        } catch (IOException | SecurityException | IllegalArgumentException error) {
            // The picker creates a fresh document. Remove it if the copy failed.
            try {
                DocumentsContract.deleteDocument(resolver, destination);
            } catch (IOException | RuntimeException ignored) {
                Log.w("ST New", "Unable to remove incomplete export");
            }
            return false;
        } finally {
            if (source != null) source.delete();
        }
    }

    void cancelTransfer() {
        if (receiving != null) discard();
    }

    void destroy() {
        if (receiving != null || activity.isFinishing()) discard();
    }

    private void discard() {
        if (receiving != null) {
            try {
                receiving.close();
            } catch (IOException ignored) {
                Log.w("ST New", "Unable to close export cache file");
            }
            receiving = null;
        }
        if (stagedFile != null) {
            stagedFile.delete();
            stagedFile = null;
        }
    }

    private void showToast(String message) {
        Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
    }
}
