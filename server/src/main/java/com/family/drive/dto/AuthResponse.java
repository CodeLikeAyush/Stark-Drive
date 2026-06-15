package com.family.drive.dto;

public class AuthResponse {
    private String token;
    private String email;
    private String name;
    private boolean hasVaultSetup;
    private String encryptedVaultKey;

    public AuthResponse() {}
    public AuthResponse(String token, String email, String name, boolean hasVaultSetup, String encryptedVaultKey) {
        this.token = token;
        this.email = email;
        this.name = name;
        this.hasVaultSetup = hasVaultSetup;
        this.encryptedVaultKey = encryptedVaultKey;
    }

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public boolean isHasVaultSetup() { return hasVaultSetup; }
    public void setHasVaultSetup(boolean hasVaultSetup) { this.hasVaultSetup = hasVaultSetup; }
    public String getEncryptedVaultKey() { return encryptedVaultKey; }
    public void setEncryptedVaultKey(String encryptedVaultKey) { this.encryptedVaultKey = encryptedVaultKey; }
}

