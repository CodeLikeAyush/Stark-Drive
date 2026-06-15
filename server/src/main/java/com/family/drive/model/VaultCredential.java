package com.family.drive.model;

import jakarta.persistence.*;

@Entity
@Table(name = "vault_credentials")
public class VaultCredential {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String type; // e.g. "PASSWORD", "CARD", "BANK", "RECOVERY_CODE", "PIN"

    @Column(nullable = false, length = 4096)
    private String encryptedData;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private User user;

    @Column(name = "updated_at", nullable = false)
    private Long updatedAt;

    public VaultCredential() {}

    public VaultCredential(String title, String type, String encryptedData, User user, Long updatedAt) {
        this.title = title;
        this.type = type;
        this.encryptedData = encryptedData;
        this.user = user;
        this.updatedAt = updatedAt;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getEncryptedData() { return encryptedData; }
    public void setEncryptedData(String encryptedData) { this.encryptedData = encryptedData; }
    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }
    public Long getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Long updatedAt) { this.updatedAt = updatedAt; }
}
