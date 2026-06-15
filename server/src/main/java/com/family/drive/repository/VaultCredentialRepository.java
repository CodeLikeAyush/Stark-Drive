package com.family.drive.repository;

import com.family.drive.model.VaultCredential;
import com.family.drive.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface VaultCredentialRepository extends JpaRepository<VaultCredential, Long> {
    List<VaultCredential> findByUserOrderByTitleAsc(User user);
}
