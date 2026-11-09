// Regression: the extractor must never inherit the staged application's working directory.
// Otherwise a child/grandchild can keep the directory open when MoveFileExW promotes it.
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#include <windows.h>
#include <cassert>
#include <cwchar>
#include <string>
#include "../installer/extract.h"

static std::wstring DirectoryOf(const std::wstring& path) {
    const auto separator = path.find_last_of(L"\\/");
    assert(separator != std::wstring::npos);
    return path.substr(0, separator + 1);
}

static void DropTrailingSeparators(std::wstring& path) {
    while (path.size() > 3 && (path.back() == L'\\' || path.back() == L'/')) path.pop_back();
}

int wmain(int argc, wchar_t** argv) {
    if (argc > 1 && wcscmp(argv[1], L"x") == 0) {
        // Behave like a harmless 7-Zip child and record the child process's CWD
        // to the final archive argument supplied by ExtractApplication.
        WCHAR childCwd[32768] = {};
        const DWORD length = GetCurrentDirectoryW(32768, childCwd);
        if (!length || length >= 32768) return 11;
        const HANDLE witness = CreateFileW(argv[argc - 1], GENERIC_WRITE, FILE_SHARE_READ,
            nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (witness == INVALID_HANDLE_VALUE) return 12;
        const DWORD expectedBytes = (length + 1) * sizeof(WCHAR);
        DWORD written = 0;
        const BOOL succeeded = WriteFile(witness, childCwd, expectedBytes, &written, nullptr);
        CloseHandle(witness);
        return succeeded && written == expectedBytes ? 0 : 13;
    }

    WCHAR executable[32768] = {};
    const DWORD exeLength = GetModuleFileNameW(nullptr, executable, 32768);
    assert(exeLength > 0 && exeLength < 32768);
    WCHAR original[32768] = {};
    const DWORD originalLength = GetCurrentDirectoryW(32768, original);
    assert(originalLength > 0 && originalLength < 32768);
    WCHAR temp[MAX_PATH] = {};
    const DWORD tempLength = GetTempPathW(MAX_PATH, temp);
    assert(tempLength > 0 && tempLength < MAX_PATH);

    const std::wstring root = std::wstring(temp) + L"dsh-extract-cwd-" + std::to_wstring(GetCurrentProcessId());
    const std::wstring stage = root + L"\\stage";
    const std::wstring promoted = root + L"\\promoted";
    const std::wstring witness = root + L"\\child-cwd.bin";
    const std::wstring log = root + L"\\extract.log";
    assert(CreateDirectoryW(root.c_str(), nullptr));
    assert(CreateDirectoryW(stage.c_str(), nullptr));

    // Reproduce NSIS's SetOutPath into the unpromoted application directory.
    assert(SetCurrentDirectoryW(stage.c_str()));
    const int extraction = ExtractApplication(nullptr, executable, witness.c_str(), stage.c_str(), log.c_str());
    assert(SetCurrentDirectoryW(original));
    assert(extraction == 0);

    const HANDLE record = CreateFileW(witness.c_str(), GENERIC_READ, FILE_SHARE_READ,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    assert(record != INVALID_HANDLE_VALUE);
    WCHAR observed[32768] = {};
    DWORD bytes = 0;
    const BOOL read = ReadFile(record, observed, sizeof(observed), &bytes, nullptr);
    CloseHandle(record);
    assert(read && bytes >= sizeof(WCHAR) && bytes % sizeof(WCHAR) == 0);
    assert(observed[bytes / sizeof(WCHAR) - 1] == L'\0');

    // The extracted payload root and the extractor's CWD must differ.
    std::wstring childDirectory(observed);
    std::wstring toolDirectory = DirectoryOf(executable);
    DropTrailingSeparators(childDirectory);
    DropTrailingSeparators(toolDirectory);
    assert(_wcsicmp(childDirectory.c_str(), toolDirectory.c_str()) == 0);
    assert(_wcsicmp(childDirectory.c_str(), stage.c_str()) != 0);

    assert(DeleteFileW(witness.c_str()));
    assert(DeleteFileW(log.c_str()));
    assert(MoveFileExW(stage.c_str(), promoted.c_str(), 0));
    assert(RemoveDirectoryW(promoted.c_str()));
    assert(RemoveDirectoryW(root.c_str()));
    return 0;
}
