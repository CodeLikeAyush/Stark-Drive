package com.family.drive.service;

import com.family.drive.dto.AuthRequest;
import com.family.drive.dto.AuthResponse;
import com.family.drive.dto.RegisterRequest;
import com.family.drive.dto.UpdateNameRequest;
import com.family.drive.model.Role;
import com.family.drive.model.User;
import com.family.drive.repository.UserRepository;
import com.family.drive.security.JwtService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthenticationService {

    private final UserRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    public AuthenticationService(UserRepository repository, PasswordEncoder passwordEncoder, JwtService jwtService, AuthenticationManager authenticationManager) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.authenticationManager = authenticationManager;
    }

    public AuthResponse register(RegisterRequest request) {
        if(repository.existsByEmail(request.getEmail())) {
            throw new RuntimeException("Email already exists");
        }
        var user = new User(
                request.getEmail(),
                passwordEncoder.encode(request.getPassword()),
                Role.USER, // Default role
                request.getName()
        );
        repository.save(user);
        var jwtToken = jwtService.generateToken(user);
        return new AuthResponse(jwtToken, user.getEmail(), user.getName(), user.isHasVaultSetup(), user.getEncryptedVaultKey());
    }

    public AuthResponse authenticate(AuthRequest request) {
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        request.getEmail(),
                        request.getPassword()
                )
        );
        var user = repository.findByEmail(request.getEmail())
                .orElseThrow();
        var jwtToken = jwtService.generateToken(user);
        return new AuthResponse(jwtToken, user.getEmail(), user.getName(), user.isHasVaultSetup(), user.getEncryptedVaultKey());
    }

    public void updateName(UpdateNameRequest request, User user) {
        user.setName(request.getName());
        repository.save(user);
    }

    public void setupVault(String encryptedVaultKey, User user) {
        user.setHasVaultSetup(true);
        user.setEncryptedVaultKey(encryptedVaultKey);
        repository.save(user);
    }

    public void updateVaultKey(String newEncryptedKey, User user) {
        user.setEncryptedVaultKey(newEncryptedKey);
        repository.save(user);
    }
}

