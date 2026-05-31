using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public class VersionInfo
{
    public string version;
    public string timestamp;
    public string description;
    public int modCount;
}

[Serializable]
public class VersionsResponse
{
    public string current_version;
    public VersionInfo[] versions;
}

public class ModApiClient : MonoBehaviour
{
    public static ModApiClient Instance;
    
    public string apiBaseUrl = "http://localhost:8000";
    public float autoUpdateInterval = 30f;
    public bool enableVersionAutoSync = false;

    private Coroutine autoUpdateCoroutine;
    private string currentSyncedVersion = "";

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }

    private void Start()
    {
        StartAutoUpdate();
    }

    public void StartAutoUpdate()
    {
        if (autoUpdateCoroutine != null)
        {
            StopCoroutine(autoUpdateCoroutine);
        }
        autoUpdateCoroutine = StartCoroutine(AutoUpdateCoroutine());
    }

    public void StopAutoUpdate()
    {
        if (autoUpdateCoroutine != null)
        {
            StopCoroutine(autoUpdateCoroutine);
            autoUpdateCoroutine = null;
        }
    }

    private IEnumerator AutoUpdateCoroutine()
    {
        while (true)
        {
            yield return new WaitForSeconds(autoUpdateInterval);
            
            if (enableVersionAutoSync)
            {
                StartCoroutine(CheckVersionSyncCoroutine());
            }
            else
            {
                var loadedMods = ModLoader.Instance.GetAllLoadedMods();
                foreach (var mod in loadedMods)
                {
                    StartCoroutine(FetchModConfig(mod.modId, null));
                }
            }
        }
    }

    private IEnumerator CheckVersionSyncCoroutine()
    {
        yield return GetAllVersionsCoroutine(
            (response) =>
            {
                if (response.current_version != currentSyncedVersion)
                {
                    Debug.Log($"检测到新版本: {currentSyncedVersion} -> {response.current_version}，开始同步...");
                    ModLoader.Instance.ReloadAllMods();
                    currentSyncedVersion = response.current_version;
                }
            },
            null
        );
    }

    public void FetchMod(string modId, Action<ModConfig> onSuccess = null, Action<string> onError = null)
    {
        StartCoroutine(FetchModConfig(modId, onSuccess, onError));
    }

    private IEnumerator FetchModConfig(string modId, Action<ModConfig> onSuccess, Action<string> onError)
    {
        string url = $"{apiBaseUrl}/api/mods/{modId}";
        
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            request.timeout = 10;
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string json = request.downloadHandler.text;
                    ModConfig modConfig = JsonUtility.FromJson<ModConfig>(json);
                    
                    if (modConfig != null && !string.IsNullOrEmpty(modConfig.modId))
                    {
                        ModLoader.Instance.LoadModFromConfig(modConfig);
                        onSuccess?.Invoke(modConfig);
                    }
                    else
                    {
                        onError?.Invoke("无效的Mod配置");
                    }
                }
                catch (Exception e)
                {
                    onError?.Invoke($"解析Mod配置失败: {e.Message}");
                }
            }
            else
            {
                string error = request.error;
                if (request.responseCode == 404)
                {
                    error = $"Mod '{modId}' 不在服务器上";
                }
                onError?.Invoke(error);
            }
        }
    }

    public void GetAllMods(Action<ModConfig[]> onSuccess = null, Action<string> onError = null)
    {
        StartCoroutine(GetAllModsCoroutine(onSuccess, onError));
    }

    private IEnumerator GetAllModsCoroutine(Action<ModConfig[]> onSuccess, Action<string> onError)
    {
        string url = $"{apiBaseUrl}/api/mods";
        
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            request.timeout = 10;
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string json = request.downloadHandler.text;
                    ModConfig[] modConfigs = JsonHelper.FromJson<ModConfig>(json);
                    onSuccess?.Invoke(modConfigs);
                }
                catch (Exception e)
                {
                    onError?.Invoke($"解析Mod列表失败: {e.Message}");
                }
            }
            else
            {
                onError?.Invoke(request.error);
            }
        }
    }

    public void CreateVersion(string version, string description = "", Action<VersionInfo> onSuccess = null, Action<string> onError = null)
    {
        StartCoroutine(CreateVersionCoroutine(version, description, onSuccess, onError));
    }

    private IEnumerator CreateVersionCoroutine(string version, string description, Action<VersionInfo> onSuccess, Action<string> onError)
    {
        string url = $"{apiBaseUrl}/api/versions/create?version={UnityWebRequest.EscapeURL(version)}&description={UnityWebRequest.EscapeURL(description)}";
        
        using (UnityWebRequest request = UnityWebRequest.Post(url, ""))
        {
            request.timeout = 15;
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string json = request.downloadHandler.text;
                    VersionInfo versionInfo = JsonUtility.FromJson<VersionInfo>(json);
                    currentSyncedVersion = version;
                    Debug.Log($"版本 {version} 创建成功！");
                    onSuccess?.Invoke(versionInfo);
                }
                catch (Exception e)
                {
                    onError?.Invoke($"创建版本失败: {e.Message}");
                }
            }
            else
            {
                onError?.Invoke($"HTTP错误 {request.responseCode}: {request.error}");
            }
        }
    }

    public void GetAllVersions(Action<VersionsResponse> onSuccess = null, Action<string> onError = null)
    {
        StartCoroutine(GetAllVersionsCoroutine(onSuccess, onError));
    }

    private IEnumerator GetAllVersionsCoroutine(Action<VersionsResponse> onSuccess, Action<string> onError)
    {
        string url = $"{apiBaseUrl}/api/versions";
        
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            request.timeout = 10;
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string json = request.downloadHandler.text;
                    VersionsResponse response = JsonUtility.FromJson<VersionsResponse>(json);
                    onSuccess?.Invoke(response);
                }
                catch (Exception e)
                {
                    onError?.Invoke($"获取版本列表失败: {e.Message}");
                }
            }
            else
            {
                onError?.Invoke(request.error);
            }
        }
    }

    public void RollbackToVersion(string version, Action<string> onSuccess = null, Action<string> onError = null)
    {
        StartCoroutine(RollbackToVersionCoroutine(version, onSuccess, onError));
    }

    private IEnumerator RollbackToVersionCoroutine(string version, Action<string> onSuccess, Action<string> onError)
    {
        string url = $"{apiBaseUrl}/api/versions/rollback";
        string jsonBody = $"{{\"version\":\"{version}\"}}";
        
        byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(jsonBody);
        
        using (UnityWebRequest request = new UnityWebRequest(url, "POST"))
        {
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.timeout = 15;
            
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                currentSyncedVersion = version;
                ModLoader.Instance.ReloadAllMods();
                Debug.Log($"已回滚到版本: {version}");
                onSuccess?.Invoke(version);
            }
            else
            {
                onError?.Invoke($"回滚失败: {request.error}");
            }
        }
    }

    public void ReloadModsFromServer(Action onSuccess = null, Action<string> onError = null)
    {
        StartCoroutine(ReloadModsCoroutine(onSuccess, onError));
    }

    private IEnumerator ReloadModsCoroutine(Action onSuccess, Action<string> onError)
    {
        string url = $"{apiBaseUrl}/api/reload";
        
        using (UnityWebRequest request = UnityWebRequest.Post(url, ""))
        {
            request.timeout = 10;
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                ModLoader.Instance.ReloadAllMods();
                onSuccess?.Invoke();
            }
            else
            {
                onError?.Invoke(request.error);
            }
        }
    }
}

public static class JsonHelper
{
    public static T[] FromJson<T>(string json)
    {
        string newJson = "{\"array\":" + json + "}";
        Wrapper<T> wrapper = JsonUtility.FromJson<Wrapper<T>>(newJson);
        return wrapper.array;
    }

    [Serializable]
    private class Wrapper<T>
    {
        public T[] array;
    }
}
