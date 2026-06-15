package com.family.drive.model;

import jakarta.persistence.*;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

@Entity
@Table(name = "users")
public class User implements UserDetails {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String email;

    @Column(nullable = false)
    private String password;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    @Column(nullable = true)
    private String name;

    @Column(nullable = false, columnDefinition = "boolean default false")
    private boolean hasVaultSetup = false;

    @Column(name = "encrypted_vault_key", nullable = true, length = 1000)
    private String encryptedVaultKey;

    public User() {}

    public User(String email, String password, Role role, String name) {
        this.email = email;
        this.password = password;
        this.role = role;
        this.name = name;
        this.hasVaultSetup = false;
        this.encryptedVaultKey = null;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public boolean isHasVaultSetup() { return hasVaultSetup; }
    public void setHasVaultSetup(boolean hasVaultSetup) { this.hasVaultSetup = hasVaultSetup; }
    public String getEncryptedVaultKey() { return encryptedVaultKey; }
    public void setEncryptedVaultKey(String encryptedVaultKey) { this.encryptedVaultKey = encryptedVaultKey; }
    public String getEmail() { return email; }

    public void setEmail(String email) { this.email = email; }
    public void setPassword(String password) { this.password = password; }
    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    // UserDetails Methods
    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return password;
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public boolean isAccountNonExpired() { return true; }

    @Override
    public boolean isAccountNonLocked() { return true; }

    @Override
    public boolean isCredentialsNonExpired() { return true; }

    @Override
    public boolean isEnabled() { return true; }
}
